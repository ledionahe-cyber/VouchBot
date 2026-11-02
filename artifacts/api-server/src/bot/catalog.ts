import type { RobloxAccount } from "./store";

export const STAFF_USER_ID = "1483135478923399258";

export const SHOP_CATEGORIES = [
  {
    value: "boost",
    label: "Server Boost",
    emoji: { id: "1493805613937987615", name: "boost", animated: true },
  },
  {
    value: "nitro",
    label: "Nitro",
    emoji: { id: "1535994182861066290", name: "Gift" },
  },
  {
    value: "decos",
    label: "Profile Decos",
    emoji: { id: "1535994182861066290", name: "Gift" },
  },
  { value: "roblox", label: "Roblox Accounts", emoji: { name: "🎮" } },
] as const;

export type ShopCategory = (typeof SHOP_CATEGORIES)[number]["value"];

export type ShopProduct = {
  label: string;
  description: string;
  value: string;
  details: string;
  emoji?: { id?: string; name: string; animated?: boolean };
};

const BOOST_EMOJI = {
  id: "1493805613937987615",
  name: "boost",
  animated: true,
};
const GIFT_EMOJI = {
  id: "1535994182861066290",
  name: "Gift",
  animated: true,
};
export const GIFT_EMOJI_TEXT = "<a:Gift:1535994182861066290>";

export const BOOST_PRODUCTS: ShopProduct[] = [
  {
    label: "1 Month • 14x",
    description: "14 boosts for 1 month — $2.75",
    value: "boost:1m:14",
    details: "1 month — 14 boosts — $2.75",
    emoji: BOOST_EMOJI,
  },
  {
    label: "1 Month • 20x",
    description: "20 boosts for 1 month — $4.45",
    value: "boost:1m:20",
    details: "1 month — 20 boosts — $4.45",
    emoji: BOOST_EMOJI,
  },
  {
    label: "3 Months • 14x",
    description: "14 boosts for 3 months — $9.50",
    value: "boost:3m:14",
    details: "3 months — 14 boosts — $9.50",
    emoji: BOOST_EMOJI,
  },
  {
    label: "3 Months • 20x",
    description: "20 boosts for 3 months — $13.75",
    value: "boost:3m:20",
    details: "3 months — 20 boosts — $13.75",
    emoji: BOOST_EMOJI,
  },
  {
    label: "Custom boost quantity",
    description: "Choose a custom number and duration",
    value: "boost:custom",
    details: "Custom server boost quantity",
    emoji: BOOST_EMOJI,
  },
];

export const NITRO_PRODUCTS: ShopProduct[] = [
  {
    label: "Nitro Boost",
    description: "€5.00",
    value: "nitro:5",
    details: "Nitro boost — €5.00",
    emoji: GIFT_EMOJI,
  },
];

const DECO_PRICES = [
  ["4.99", "1.85"],
  ["5.99", "2.25"],
  ["6.99", "2.68"],
  ["7.99", "2.92"],
  ["8.55", "3.07"],
  ["8.99", "3.20"],
  ["9.99", "3.84"],
  ["11.99", "5.15"],
  ["12.99", "5.80"],
] as const;

export const DECO_PRODUCTS: ShopProduct[] = DECO_PRICES.map(
  ([original, price], index) => ({
    label: `€${original} → €${price}`,
    description: `Gift value €${original} • You pay €${price}`,
    value: `deco:${index}`,
    details: `Profile deco — Gift €${original} → €${price}`,
    emoji: GIFT_EMOJI,
  }),
);

export function robloxProduct(account: RobloxAccount): ShopProduct {
  return {
    label: account.username.slice(0, 100),
    description: `${account.price} • ${account.description.slice(0, 70) || "Roblox account"}`,
    value: `roblox:${account.id}`,
    details: `Roblox account: ${account.username}\nPrice: ${account.price}\nDescription: ${account.description || "No description provided."}`,
    emoji: { name: "🎮" },
  };
}

export function getStaticProducts(
  category: Exclude<ShopCategory, "roblox">,
): ShopProduct[] {
  if (category === "boost") return BOOST_PRODUCTS;
  if (category === "nitro") return NITRO_PRODUCTS;
  return DECO_PRODUCTS;
}

export function productForStaticValue(value: string): ShopProduct | undefined {
  return [...BOOST_PRODUCTS, ...NITRO_PRODUCTS, ...DECO_PRODUCTS].find(
    (product) => product.value === value,
  );
}
