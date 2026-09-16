// 下界 (nether) + 末地 (end) 地标样本数据
//
// 数据格式见 @/lib/map/labels 里的 NewLabel / NewRegionLabel / NewBuildingLandmark / NewMachineLandmark
// 跟 ./overworld.ts + ./index.ts 合并后作为 LABELS 暴露给 app/map/page.tsx
//
// 添加新地标时直接编辑本文件, 格式参考已有条目; id 必须全局唯一 (跨主世界/下界/末地)
import type { NewLabel } from "@/lib/map/labels";

export const NETHER_LABELS: NewLabel[] = [

    {
      id: "ender-pearl-cannon",
      name: "矢量珍珠炮",
      x: 8,
      z: 25,
      targetZoom: 800,
      kind: "machine",
      builder: "Aurora1229937 QingShi",
      description: "实现超远距离传送的大型装置，选定目的地，投掷珍珠，即可在数秒内抵达对应出口",
      fontSize: { min: 14, max: 20, maxZoom: 800 },
      images: [
        "/images/maps/thumbs/machines/nether/矢量珍珠炮.webp",
      ],
    }
    , {
      id: "piglin-farm",
      name: "猪人塔",
      x: 311,
      z: -98,
      targetZoom: 800,
      kind: "machine",
      builder: "Aurora1229937 CMLOCK 核摇Prog_Metalcore yunzhongxian",
      description: "收集装置位于主世界",
      fontSize: { min: 12, max: 16, maxZoom: 800 },
      images: [
        "/images/maps/thumbs/machines/nether/猪人塔.webp",
      ],
      outputs: [
        { label: "金锭", icon: "/icons/map/items/gold_ingot.png" },
      ],
    }
    , {
      id: "ghast-farm",
      name: "恶魂农场",
      x: 390,
      z: 82,
      targetZoom: 800,
      kind: "machine",
      builder: "Aurora1229937 CMLOCK",
      description: "收集装置位于主世界",
      fontSize: { min: 12, max: 16, maxZoom: 800 },
      images: [
        "/images/maps/thumbs/machines/nether/恶魂农场.webp",
      ],
      outputs: [
        { label: "恶魂之泪", icon: "/icons/map/items/ghast_tear.png" },
        { label: "火药", icon: "/icons/map/items/gunpowder.png" },
      ],
    }
    , {
      id: "wither-skeleton-farm",
      name: "凋灵骷髅农场",
      x: 4040,
      z: -1060,
      targetZoom: 800,
      kind: "machine",
      builder: "Aurora1229937 CMLOCK QingShi",
      description: "收集装置位于主世界",
      fontSize: { min: 12, max: 16, maxZoom: 800 },
      images: [
        "/images/maps/thumbs/machines/nether/凋灵骷髅农场.webp",
      ],
      outputs: [
        { label: "凋灵骷髅头颅", icon: "null" },
        { label: "煤炭", icon: "/icons/map/items/coal.png" },
        { label: "骨头", icon: "/icons/map/items/bone.png" },
      ],
    }
    , {
      id: "piglin-trading-hall",
      name: "猪灵交易所",
      x: -628,
      z: -32,
      targetZoom: 800,
      kind: "machine",
      builder: "Aurora1229937 CMLOCK 核摇Prog_Metalcore",
      fontSize: { min: 12, max: 16, maxZoom: 800 },
      images: [
        "/images/maps/thumbs/machines/nether/猪灵交易所.webp",
      ],
      inputs: [
        { label: "金锭", icon: "/icons/map/items/gold_ingot.png" },
      ],
      outputs: [
        { label: "下界石英", icon: "/icons/map/items/quartz.png" },
        { label: "黑曜石", icon: "/icons/map/blocks/obsidian.png" },
        { label: "哭泣的黑曜石", icon: "/icons/map/blocks/crying_obsidian.png" },
        { label: "灵魂沙", icon: "/icons/map/blocks/soul_sand.png" },
        { label: "黑石", icon: "/icons/map/blocks/blackstone.png" },
        { label: "沙砾", icon: "/icons/map/blocks/gravel.png" },
        { label: "皮革", icon: "/icons/map/items/leather.png" },
        { label: "下界砖", icon: "/icons/map/items/nether_brick.png" },
        { label: "光灵箭", icon: "/icons/map/items/spectral_arrow.png" },
        { label: "火焰弹", icon: "/icons/map/items/fire_charge.png" },
        { label: "末影珍珠", icon: "/icons/map/items/ender_pearl.png" },
        { label: "失水恶魂", icon: "null" },
        { label: "抗火药水", icon: "/icons/map/effect/fire_resistance.png" },
        { label: "灵魂疾行", icon: "/icons/map/items/enchanted_book.png" },
      ],
    }
    , {
      id: "boat-mob-farm-collection",
      name: "船吸刷怪塔收集",
      x: -338,
      z: 96,
      targetZoom: 800,
      kind: "machine",
      builder: "QingShi",
      description: "通过摔落处死船吸刷怪塔生成的怪物，启用时能看到“怪物瀑布”，刷怪结构位于主世界",
      fontSize: { min: 12, max: 18, maxZoom: 800 },
      images: [
        "/images/maps/thumbs/machines/nether/船吸刷怪塔收集.webp",
      ],
      outputs: [
        { label: "火药", icon: "/icons/map/items/gunpowder.png" },
        { label: "骨粉", icon: "/icons/map/items/bone_meal.png" },
        { label: "红石粉", icon: "/icons/map/items/redstone.png" },
        { label: "萤石粉", icon: "/icons/map/items/glowstone_dust.png" },
        { label: "箭", icon: "/icons/map/items/arrow.png" },
        { label: "玻璃瓶", icon: "/icons/map/items/glass_bottle.png" },
      ],
    }
    , {
      id: "magma-cube-farm",
      name: "岩浆怪农场",
      x: -105,
      z: 94,
      targetZoom: 800,
      kind: "machine",
      builder: "Aurora1229937 yunzhongxian",
      fontSize: { min: 10, max: 14, minZoom: 150, maxZoom: 800 },
      images: [
        "/images/maps/thumbs/machines/nether/岩浆怪农场.webp",
      ],
      outputs: [
        { label: "岩浆膏", icon: "/icons/map/items/magma_cream.png" },
      ],
    }
    , {
      id: "froglight-farm",
      name: "蛙明灯农场",
      x: -171,
      z: 90,
      offsetY: 15,
      targetZoom: 800,
      kind: "machine",
      builder: "CMLOCK Aurora1229937",
      description: "收集装置位于主世界",
      fontSize: { min: 10, max: 16, minZoom: 150, maxZoom: 800 },
      images: [
        "/images/maps/thumbs/machines/nether/蛙明灯农场.webp",
      ],
      outputs: [
        { label: "赭黄蛙明灯", icon: "/icons/map/blocks/ochre_froglight_side.png" },
        { label: "珠光蛙明灯", icon: "/icons/map/blocks/pearlescent_froglight_side.png" },
        { label: "青翠蛙明灯", icon: "/icons/map/blocks/verdant_froglight_side.png" },
        { label: "岩浆膏", icon: "/icons/map/items/magma_cream.png" },
      ],
    }
    , {
      id: "blaze-farm",
      name: "烈焰人农场",
      x: -217,
      z: 75,
      offsetY: -5,
      targetZoom: 800,
      kind: "machine",
      builder: "mc_zte",
      fontSize: { min: 10, max: 14, minZoom: 150, maxZoom: 800 },
      images: [
        "/images/maps/thumbs/machines/nether/烈焰人农场.webp",
      ],
      outputs: [
        { label: "烈焰棒", icon: "/icons/map/items/blaze_rod.png" },
      ],
    }
    , {
      id: "basalt-generator",
      name: "玄武岩机",
      x: -4,
      z: -22,
      targetZoom: 800,
      kind: "machine",
      builder: "QingShi",
      fontSize: { min: 10, max: 12, minZoom: 200, maxZoom: 800 },
      images: [
        "/images/maps/thumbs/machines/nether/玄武岩机.webp",
      ],
      outputs: [
        { label: "玄武岩", icon: "/icons/map/blocks/basalt_side.png" },
      ],
    }
    , {
      id: "porkchop-farm",
      name: "猪肉塔",
      x: 67,
      z: 26,
      targetZoom: 800,
      kind: "machine",
      builder: "核摇Prog_Metalcore",
      fontSize: { min: 10, max: 14, minZoom: 400, maxZoom: 800 },
      images: [
        "/images/maps/thumbs/machines/nether/猪肉塔.webp",
      ],
      outputs: [
        { label: "熟猪排", icon: "/icons/map/items/cooked_porkchop.png" },
        { label: "皮革", icon: "/icons/map/items/leather.png" },
      ],
    }
    , {
      id: "guardian-farm-collection",
      name: "守卫者农场收集",
      x: -38,
      z: -40,
      targetZoom: 800,
      kind: "machine",
      builder: "CMLOCK Aurora1229937 QingShi",
      description: "刷怪结构位于主世界",
      fontSize: { min: 10, max: 14, minZoom: 375, maxZoom: 800 },
      images: [
        "/images/maps/thumbs/machines/nether/守卫者农场收集.webp",
      ],
      outputs: [
        { label: "海晶碎片", icon: "/icons/map/items/prismarine_shard.png" },
        { label: "海晶砂粒", icon: "/icons/map/items/prismarine_crystals.png" },
        { label: "生鳕鱼", icon: "/icons/map/items/cod.png" },
      ],
    }
    , {
      id: "overworld-pseudo-peaceful-switch",
      name: "主世界伪和平开关",
      x: 91,
      z: 305,
      targetZoom: 800,
      kind: "machine",
      builder: "QingShi",
      fontSize: { min: 10, max: 16, mid: 12 , midZoom: 150, maxZoom: 800 },
      images: [
        "/images/maps/thumbs/machines/nether/主世界伪和平开关.webp",
      ],
    }
    , {
      id: "tunnel-boring-machine",
      name: "盾构机",
      x: -125,
      z: 30,
      targetZoom: 800,
      kind: "machine",
      builder: "Marcus",
      fontSize: { min: 10, max: 14, minZoom: 200, maxZoom: 800 },
      images: [
        "/images/maps/thumbs/machines/nether/盾构机.webp",
      ],
      outputs: [
        { label: "远古残骸", icon: "/icons/map/blocks/ancient_debris_side.png" },
        { label: "下界石英", icon: "/icons/map/items/quartz.png" },
        { label: "金粒", icon: "/icons/map/items/gold_nugget.png" },
        { label: "下界岩", icon: "/icons/map/blocks/netherrack.png" },
      ],
    },

    {
      id: "witch-farm-exit",
      name: "出口-女巫塔",
      x: -608,
      z: -55,
      offsetY: -6,
      kind: "region",
      targetZoom: 800,
      description: "下界传送门位于女巫塔附近",
      popup: true,
      visibleWhen: "transit",
      fontSize: { min: 12, max: 14, maxZoom: 800 },
      withLabels: {
        fontSize: { min: 8, max: 14, mid: 10, midZoom: 300, maxZoom: 800  },
      },
      images: [
        "/images/maps/thumbs/transit/nether/出口-女巫塔.webp",
      ]
    },
    {
      id: "boat-mob-farm-exit",
      name: "出口-船吸",
      x: -326,
      z: 80,
      offsetY: -7,
      kind: "region",
      targetZoom: 800,
      description: "下界传送门位于空置域、船吸刷怪塔附近",
      popup: true,
      visibleWhen: "transit",
      fontSize: { min: 12, max: 14, maxZoom: 800 },
      withLabels: {
        fontSize: { min: 8, max: 14, mid: 10, midZoom: 300, maxZoom: 800  },
      },
      images: [
        "/images/maps/thumbs/transit/nether/出口-船吸.webp",
      ],
    },
    {
      id: "trial-chamber-exit",
      name: "出口-试炼密室",
      x: -238,
      z: 286,
      kind: "region",
      targetZoom: 800,
      description: "下界传送门位于试炼密室附近",
      popup: true,
      visibleWhen: "transit",
      fontSize: { min: 12, max: 14, minZoom: 150, maxZoom: 800  },
      withLabels: {
        fontSize: { min: 12, max: 14, minZoom: 150, maxZoom: 800  },
      },
      images: [
        "/images/maps/thumbs/transit/nether/出口-试炼密室.webp",
      ],
    },
    {
      id: "raid-farm-exit",
      name: "出口-袭击塔",
      x: 5,
      z: 286,
      offsetY: -6,
      offsetX: 4,
      kind: "region",
      targetZoom: 800,
      description: "下界传送门位于袭击塔",
      popup: true,
      visibleWhen: "transit",
      fontSize: { min: 12, max: 14, maxZoom: 800 },
      withLabels: {
        fontSize: { min: 8, max: 14, mid: 10, midZoom: 300, maxZoom: 800  },
      },
      images: [
        "/images/maps/thumbs/transit/nether/出口-袭击塔.webp",
      ],
    },
    {
      id: "end-portal-and-sand-duper-exit",
      name: "出口-末地门/刷沙机",
      x: -90,
      z: -191,
      kind: "region",
      targetZoom: 800,
      description: "下界传送门位于末地门刷沙机附近",
      popup: true,
      visibleWhen: "transit",
      fontSize: { min: 12, max: 16, maxZoom: 800 },
      withLabels: {
        fontSize: { min: 10, max: 16, mid: 12, midZoom: 300, maxZoom: 800  },
      },
      images: [
        "/images/maps/thumbs/transit/nether/出口-末地门刷沙机.webp",
      ],
    },
    {
      id: "octagonal-pagoda-exit",
      name: "出口-八角塔",
      x: 47,
      z: -66,
      kind: "region",
      targetZoom: 800,
      description: "下界传送门位于八角楼",
      popup: true,
      visibleWhen: "transit",
      fontSize: { min: 10, max: 14, minZoom: 200, maxZoom: 800  },
      withLabels: {
        fontSize: { min: 10, max: 14, minZoom: 200, maxZoom: 800  },
      },
      images: [
        "/images/maps/thumbs/transit/nether/出口-八角塔.webp",
      ],
    },
    {
      id: "map-art-factory-exit",
      name: "出口-地图画工厂",
      x: 118,
      z: -134,
      kind: "region",
      targetZoom: 800,
      description: "下界传送门位于地图画工厂",
      popup: true,
      visibleWhen: "transit",
      fontSize: { min: 10, max: 14, minZoom: 200, maxZoom: 800  },
      withLabels: {
        fontSize: { min: 10, max: 14, minZoom: 200, maxZoom: 800  },
      },
      images: [
        "/images/maps/thumbs/transit/nether/出口-地图画工厂.webp",
      ],
    },
    {
      id: "villager-trading-hall-exit",
      name: "出口-村民交易所",
      x: 14,
      z: -18,
      offsetY: -3,
      kind: "region",
      targetZoom: 800,
      description: "下界传送门位于村民交易所、刷铁机附近",
      popup: true,
      visibleWhen: "transit",
      fontSize: { min: 10, max: 12, minZoom: 300, maxZoom: 800 },
      withLabels: {
        fontSize: { min: 12, max: 12, minZoom: 800, maxZoom: 800  },
        offsetX: 38,
      },
      images: [
        "/images/maps/thumbs/transit/nether/出口-村民交易所.webp",
      ],
    },
    {
      id: "base-exit",
      name: "出口-基地",
      x: 8,
      z: -6,
      offsetY: 7,
      kind: "region",
      targetZoom: 800,
      description: "下界传送门位于基地",
      popup: true,
      visibleWhen: "transit",
      fontSize: { min: 14, max: 16, maxZoom: 800 },
      withLabels: {
        fontSize: { min: 12, max: 16, minZoom: 600, maxZoom: 800  },
      },
      images: [
        "/images/maps/thumbs/transit/nether/出口-基地.webp",
      ],
    },
    {
      id: "gdufs-logo-exit",
      name: "出口-广外校徽",
      x: 288,
      z: -300,
      offsetY: 7,
      kind: "region",
      targetZoom: 800,
      description: "下界传送门位于广外校徽附近",
      popup: true,
      visibleWhen: "transit",
      fontSize: { min: 10, max: 14, mid: 12, midZoom: 300, maxZoom: 800 },
      withLabels: {
        fontSize: { min: 8, max: 14, mid: 10, midZoom: 300, maxZoom: 800 },
      },
      images: [
        "/images/maps/thumbs/transit/nether/出口-广外校徽.webp",
      ],
    },
    {
      id: "piglin-farm-collection-exit",
      name: "出口-猪人塔收集",
      x: 272,
      z: -9,
      offsetX: 8,
      kind: "region",
      targetZoom: 800,
      description: "猪人塔的通勤传送门，可沿冰道前往猪人塔收集",
      popup: true,
      visibleWhen: "transit",
      fontSize: { min: 10, max: 14, mid: 12, midZoom: 300, maxZoom: 800 },
      withLabels: {
        fontSize: { min: 8, max: 14, mid: 10, midZoom: 300, maxZoom: 800 },
      },
      images: [
        "/images/maps/thumbs/transit/nether/出口-猪人塔收集.webp",
      ],
    },
    {
      id: "ice-farm-exit",
      name: "出口-刷冰机",
      x: 710,
      z: 5,
      kind: "region",
      targetZoom: 800,
      description: "下界传送门位于冻洋、刷冰机附近",
      popup: true,
      visibleWhen: "transit",
      fontSize: { min: 12, max: 14, maxZoom: 800 },
      withLabels: {
        fontSize: { min: 12, max: 14, maxZoom: 800 },
      },
      images: [
        "/images/maps/thumbs/transit/nether/出口-刷冰机.webp",
      ],
    },
    {
      id: "map-art-exit",
      name: "出口-翁法罗斯英雄纪地图画",
      x: 1850,
      z: -524,
      kind: "region",
      targetZoom: 800,
      description: "下界传送门位于翁法罗斯英雄纪地图画附近",
      popup: true,
      visibleWhen: "transit",
      fontSize: { min: 12, max: 14, maxZoom: 800 },
      withLabels: {
        fontSize: { min: 12, max: 14, maxZoom: 800 },
      },
      images: [
        "/images/maps/thumbs/transit/nether/出口-翁法罗斯英雄纪地图画.webp",
      ],
    },
    {
      id: "bee-farm-exit",
      name: "出口-蜜蜂农场",
      x: -18,
      z: -643,
      kind: "region",
      targetZoom: 800,
      description: "下界传送门位于蜜蜂农场附近",
      popup: true,
      visibleWhen: "transit",
      fontSize: { min: 12, max: 14, maxZoom: 800 },
      withLabels: {
        fontSize: { min: 12, max: 14, maxZoom: 800 },
      },
      images: [
        "/images/maps/thumbs/transit/nether/出口-蜜蜂农场.webp",
      ],
    },
    {
      id: "wither-skeleton-farm-collection-exit",
      name: "出口-凋灵骷髅农场收集",
      x: 4020,
      z: -1065,
      offsetY: -10,
      kind: "region",
      targetZoom: 800,
      description: "凋灵骷髅农场的通勤传送门，可沿冰道前往凋灵骷髅农场收集",
      popup: true,
      visibleWhen: "transit",
      fontSize: { min: 12, max: 14, maxZoom: 800 },
      withLabels: {
        fontSize: { min: 8, max: 14, mid: 10, midZoom: 300, maxZoom: 800 },
      },
      images: [
        "/images/maps/thumbs/transit/nether/出口-凋灵骷髅农场收集.webp",
      ],
    },
]

export const END_LABELS: NewLabel[] = [
    {
      id: "orbital-dragon-slayer-cannon",
      name: "天基屠龙炮",
      x: 0,
      z: 0,
      targetZoom: 800,
      kind: "machine",
      builder: "Aurora1229937 CMLOCK KirkLee123",
      description: "用于瞬杀末影龙的大型装置",
      fontSize: { min: 14, max: 20, maxZoom: 600 },
      images: [
        "/images/maps/thumbs/machines/end/天基屠龙炮.webp",
      ],
    }
    , {
      id: "water-stream-all-items-sorter",
      name: "水流全物品",
      x: 346,
      z: 160,
      targetZoom: 800,
      kind: "machine",
      builder: "QingShi Aurora1229937 KirkLee123 CMLOCK",
      description: "以水流运输为主的大型全物品分类、仓储装置",
      fontSize: { min: 14, max: 20, maxZoom: 600 },
      images: [
        "/images/maps/thumbs/machines/end/水流全物品.webp",
        "/images/maps/thumbs/machines/end/水流全物品-内饰.webp",
      ],
    }
    , {
      id: "clay-industrial-park",
      name: "粘土工业园",
      x: 400,
      z: 268,
      targetZoom: 600,
      kind: "region",
      builder: "QingShi",
      description: "包含粘土量产的全链条机器",
      fontSize: { min: 12, max: 16, mid: 14, midZoom: 200, maxZoom: 500 },
      images: [
        "/images/maps/thumbs/regions/粘土工业园.webp",
      ]
    }
    , {
      id: "chorus-fruit-farm",
      name: "紫颂果农场",
      x: -320,
      z: 3,
      targetZoom: 600,
      kind: "machine",
      builder: "QingShi",
      fontSize: { min: 12, max: 16, maxZoom: 600 },
      images: [
        "/images/maps/thumbs/machines/end/紫颂果农场.webp",
      ],
      inputs: [
        { label: "紫颂花", icon: "/icons/map/blocks/chorus_flower.png" },
      ],
      outputs: [
        { label: "紫颂果", icon: "/icons/map/items/chorus_fruit.png" },
      ],
    }
    , {
      id: "concrete-solidifier-and-sand-duper-collection",
      name: "固化机/刷沙机收集",
      x: 100,
      z: 1,
      targetZoom: 600,
      kind: "machine",
      builder: "Aurora1229937",
      description: "可根据情况切换刷沙、固化模式，生产装置位于主世界",
      fontSize: { min: 12, max: 14, minZoom: 320, maxZoom: 600 },
      images: [
        "/images/maps/thumbs/machines/end/固化机及刷沙机收集.webp",
      ],
      outputs: [
        { label: "沙子", icon: "/icons/map/blocks/sand.png" },
        { label: "沙砾", icon: "/icons/map/blocks/gravel.png" },
        { label: "混凝土", icon: "/icons/map/blocks/white_concrete.png" },
        { label: "混凝土粉末", icon: "/icons/map/blocks/white_concrete_powder.png" },
        { label: "铁砧", icon: "null" },
      ],
    }
    , {
      id: "enderman-farm",
      name: "小黑塔",
      x: 205,
      z: 0,
      targetZoom: 600,
      kind: "machine",
      builder: "KirkLee123",
      description: "手动处死可获得大量经验",
      fontSize: { min: 12, max: 16, maxZoom: 600 },
      images: [
        "/images/maps/thumbs/machines/end/小黑塔.webp",
      ],
      outputs: [
        { label: "末影珍珠", icon: "/icons/map/items/ender_pearl.png" },
      ],
    }
    , {
      id: "b36-tnt-tree-farm",
      name: "B36炸树场",
      x: 104,
      z: 306,
      targetZoom: 600,
      kind: "machine",
      builder: "QingShi",
      fontSize: { min: 12, max: 16, maxZoom: 600 },
      images: [
        "/images/maps/thumbs/machines/end/B36炸树场.webp",
      ],
      description: "可适配全类型树苗",
      inputs: [
        { label: "树苗", icon: "/icons/map/blocks/spruce_sapling.png" },
        { label: "骨粉", icon: "/icons/map/items/bone_meal.png" },
      ],
      outputs: [
        { label: "原木", icon: "/icons/map/blocks/spruce_log.png" },
        { label: "圆石", icon: "/icons/map/blocks/cobblestone.png" },
        { label: "树苗", icon: "/icons/map/blocks/oak_sapling.png" },
        { label: "木棍", icon: "/icons/map/items/stick.png" },
      ],
    }
    , {
      id: "shulker-farm",
      name: "潜影贝农场",
      x: -542,
      z: -780,
      targetZoom: 600,
      kind: "machine",
      builder: "QingShi",
      fontSize: { min: 12, max: 16, maxZoom: 600 },
      images: [
        "/images/maps/thumbs/machines/end/潜影贝农场.webp",
      ],
      outputs: [
        { label: "潜影壳", icon: "/icons/map/items/shulker_shell.png" },
      ],
    }
    , {
      id: "640-furnace-array",
      name: "640熔炉组",
      x: 440,
      z: 160,
      targetZoom: 600,
      kind: "machine",
      builder: "Aurora1229937 QingShi",
      description: "装配有白名单系统，可根据情况切换散装、打包模式",
      fontSize: { min: 12, max: 16,minZoom: 250 , maxZoom: 600 },
      images: [
        "/images/maps/thumbs/machines/end/640熔炉组.webp",
      ],
    }
    , {
      id: "dirt-generator",
      name: "泥土机",
      x: 390,
      z: 253,
      targetZoom: 600,
      kind: "machine",
      builder: "QingShi",
      fontSize: { min: 12, max: 14, minZoom: 501, maxZoom: 600 },
      images: [
        "/images/maps/thumbs/machines/end/泥土机.webp",
      ],
      inputs: [
        { label: "砂土", icon: "/icons/map/blocks/coarse_dirt.png" },
      ],
      outputs: [
        { label: "泥土", icon: "/icons/map/blocks/dirt.png" },
      ],
    }
    , {
      id: "mud-generator",
      name: "泥巴机",
      x: 390,
      z: 275,
      targetZoom: 600,
      kind: "machine",
      builder: "QingShi",
      fontSize: { min: 12, max: 14, minZoom: 501, maxZoom: 600 },
      images: [
        "/images/maps/thumbs/machines/end/泥巴机.webp",
      ],
      inputs: [
        { label: "泥土", icon: "/icons/map/blocks/dirt.png" },
      ],
      outputs: [
        { label: "泥巴", icon: "/icons/map/blocks/mud.png" },
      ],
    }
    , {
      id: "pointed-dripstone-farm",
      name: "滴水石锥农场",
      x: 405,
      z: 258,
      offsetY: 5,
      targetZoom: 600,
      kind: "machine",
      builder: "QingShi",
      fontSize: { min: 10, max: 12, minZoom: 501, maxZoom: 600 },
      images: [
        "/images/maps/thumbs/machines/end/滴水石锥农场.webp",
      ],
      outputs: [
        { label: "滴水石锥", icon: "/icons/map/items/pointed_dripstone.png" },
      ],
    }
    , {
      id: "clay-generator",
      name: "粘土机",
      x: 412,
      z: 282,
      offsetY: 3,
      targetZoom: 600,
      kind: "machine",
      builder: "QingShi",
      fontSize: { min: 12, max: 14, minZoom: 501, maxZoom: 600 },
      images: [
        "/images/maps/thumbs/machines/end/粘土机.webp",
      ],
      inputs: [
        { label: "泥巴", icon: "/icons/map/blocks/mud.png" },
      ],
      outputs: [
        { label: "黏土球", icon: "/icons/map/items/clay_ball.png" },
      ],
    }
];
