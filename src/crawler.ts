import { PrismaClient } from "./generated/client/edge";
import { createJupiterApiClient } from "@jup-ag/api";
import { withAccelerate } from "@prisma/extension-accelerate";
import { chunk } from "lodash";

const prisma = new PrismaClient().$extends(withAccelerate());

interface PriceData {
  data: Record<
    string,
    {
      id: string;
      mintSymbol: string;
      vsToken: string;
      vsTokenSymbol: string;
      price: number;
    }
  >;
}
const fetchPrice = async (mints: string[]) => {
  const pricesHash: Record<string, number> = {};
  await Promise.all(
    chunk(mints, 100).map(async (mints) => {
      try {
        const response = await fetch(
          "https://price.jup.ag/v4/price?ids=" + mints.join(",")
        );
        const { data } = (await response.json()) as PriceData;
        Object.values(data).forEach(({ id, price }) => {
          pricesHash[id] = price;
        });
      } catch (e) {
        console.error(
          "Error fetching prices for mints: ",
          mints,
          " error: ",
          e
        );
      }
    })
  );

  return pricesHash;
};

const getMints = async () => {
  const jupiterApiClient = createJupiterApiClient();

  const routeMap = await jupiterApiClient.indexedRouteMapGet();

  const mints = routeMap.mintKeys;

  await prisma.mint.createMany({
    data: mints.map((mintKey) => ({
      mint: mintKey,
    })),
    skipDuplicates: true,
  });

  const dbMints = await prisma.mint.findMany();

  const mintToId = dbMints.reduce((map, { id, mint }) => {
    map.set(mint, id);
    return map;
  }, new Map<string, number>());

  return { mintToId, mints };
};

const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
const INTERVAL = 2 * 1000; // 4.5 seconds
const FETCH_MINT_INTERVAL = 5 * 60 * 1000; // 5 minute
async function main() {
  const mintsRef = await getMints();

  setInterval(async () => {
    try {
      const { mintToId, mints } = await getMints();
      mintsRef.mintToId = mintToId;
      mintsRef.mints = mints;
    } catch (e) {
      console.error("Error fetching mints: ", e);
    }
  }, FETCH_MINT_INTERVAL);

  let pricesHash: Record<string, number> = {};
  while (true) {
    let now = process.uptime();
    const newPricesHash = await fetchPrice(mintsRef.mints);

    // only update if changed to db
    Object.entries(newPricesHash).forEach(([mint, price]) => {
      if (price !== pricesHash[mint]) {
        pricesHash[mint] = price;
      } else {
        delete newPricesHash[mint];
      }
    });

    console.log("Fetched prices in ", process.uptime() - now, " seconds");

    await prisma.price.createMany({
      data: Object.entries(newPricesHash).map(([mint, price]) => ({
        mintId: mintsRef.mintToId.get(mint)!,
        price,
      })),
    });

    const elapsed = (process.uptime() - now) * 1000;

    await wait(Math.max(0, INTERVAL - elapsed)); // save
  }
}

await main();
