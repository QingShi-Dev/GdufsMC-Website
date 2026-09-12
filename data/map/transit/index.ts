/**
 * 地图 transit 数据 — 跟 landmarks 类似的 pattern
 *  - 父组件 app/map/page.tsx import TRANSIT
 *  - 想加/改数据时, 修改 overworld.ts / other-dims.ts 即可
 */
import overworld from "./overworld";
import { nether, end } from "./other-dims";
import type { NewTransitGroups } from "@/lib/map/transit";

export const TRANSIT: NewTransitGroups = {
  overworld,
  nether,
  end,
};
