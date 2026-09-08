import { NewGuideMap } from "@/components/new-guide-map";
import { MapViewTabs } from "@/components/map-view-tabs";
import { loadNewGuideMapData } from "@/lib/new-guide-map-data";

/**
 * new-guide-map 示例页
 * - server component: 读 public/images/maps/20260907/ 拼成 NewWorldMeta[]
 * - client component: <NewGuideMap worlds={...} /> 接管 zoom/pan/fullscreen
 * - 顶部 tabs 跟 /map 页共用 MapViewTabs, 群系地图 tab 标题右侧带短 URL
 */
export default function NewGuideMapPage() {
  const worlds = loadNewGuideMapData();

  return (
    <div className="pt-28 sm:pt-34 pb-12 sm:pb-16 px-4 sm:px-6 lg:px-8 relative overflow-hidden">
      <div className="mx-auto max-w-7xl">
        <MapViewTabs />
        <div className="sm:mt-12">
          <NewGuideMap worlds={worlds} />
        </div>
      </div>
    </div>
  );
}
