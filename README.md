# Wandering Earth

`Wandering Earth` 是一款俯视角 3D 网页解谜游戏。玩家控制带喷射能力的地球，在宇宙星球之间利用引力捕获、切线脱离和质量成长完成关卡目标。

## 运行

```bash
pnpm install
pnpm dev
pnpm build
```

开发服务器默认由 Vite 启动，当前项目使用：

- TypeScript
- Vite
- Three.js
- DOM HUD + WebGL 主画面

## 工程结构

```text
src/
  main.ts
  styles.css
  game/
    input.ts
    level.ts
    simulation.ts
    vector.ts
    levels/
      index.ts
      level-01-gravity-chain.ts
      level-02-many-body-maze.ts
  render/
    UniverseRenderer.ts
  ui/
    Hud.ts
```

## 架构设计

项目采用三层拆分：关卡数据、玩法模拟、渲染表现。

### 关卡数据层

关卡类型定义在 `src/game/level.ts`。

每一关独立放在 `src/game/levels/` 下，一个关卡一个文件。当前第一关是：

```text
src/game/levels/level-01-gravity-chain.ts
```

当前关卡列表：

```text
src/game/levels/level-01-gravity-chain.ts
src/game/levels/level-02-many-body-maze.ts
```

关卡文件只描述数据，不写玩法逻辑，包括：

- `bounds`：屏幕/关卡边界
- `startPosition`：地球出生位置
- `startVelocity`：地球初始速度
- `goalMass`：目标质量
- `goalShards`：目标碎星数量
- `planets`：星球列表，包括位置、质量、半径、引力圈、颜色、是否有星环

`src/game/levels/index.ts` 负责导出关卡列表和当前默认关卡。

### 玩法模拟层

核心 gameplay 在 `src/game/simulation.ts`。

它负责维护游戏状态和规则：

- 开始、重开、胜利、失败
- 地球直线飞行
- Space 喷射加速
- 喷射状态下不被大星吸附
- 松开喷射后进入大星引力圈会被捕获
- 围绕大质量星球旋转
- Space 沿当前切线方向脱离轨道
- 地球吸附范围内的小星
- 撞碎/吸收比自己质量小的星球
- 撞到比自己质量大的星球会碎裂失败
- 地球飞出边界失败

模拟层不直接操作 Three.js Mesh。它只输出状态和事件，供渲染层消费。

### 渲染表现层

Three.js 渲染集中在 `src/render/UniverseRenderer.ts`。

它根据 simulation 状态绘制：

- 宇宙背景、星云、星空
- 星球、星环、质量标签
- 大星引力圈
- 地球、地球质量标签、地球吸附圈
- 喷射火焰、轨迹线
- 捕获/脱离冲击波
- 撞碎爆炸、碎片吸附效果
- 撞大星失败时的地球碎裂效果

渲染层只表现状态，不决定 gameplay 规则。

### UI 层

DOM HUD 在 `src/ui/Hud.ts` 和 `src/styles.css`。

负责：

- 开始界面
- 失败/胜利弹窗
- 当前目标
- 当前轨道状态
- 地球质量、直径、已撞碎数量
- Space 操作提示

## 新增关卡流程

1. 在 `src/game/levels/` 新建关卡文件，例如：

```text
src/game/levels/level-03-xxx.ts
```

2. 导出一个 `LevelDefinition`：

```ts
import type { LevelDefinition } from "../level";

export const LEVEL_03_XXX: LevelDefinition = {
  id: "level-03-xxx",
  name: "第三关：...",
  bounds: { x: 23.5, y: 13.2 },
  startPosition: { x: -21, y: -8 },
  startVelocity: { x: 4, y: 2 },
  goalMass: 8,
  goalShards: 6,
  planets: [],
};
```

3. 在 `src/game/levels/index.ts` 中导出并加入 `LEVELS`：

```ts
import { LEVEL_01_GRAVITY_CHAIN } from "./level-01-gravity-chain";
import { LEVEL_02_MANY_BODY_MAZE } from "./level-02-many-body-maze";
import { LEVEL_03_XXX } from "./level-03-xxx";

export const LEVELS = [LEVEL_01_GRAVITY_CHAIN, LEVEL_02_MANY_BODY_MAZE, LEVEL_03_XXX] as const;
```

4. 如果要切换默认启动关卡，修改：

```ts
export const FIRST_LEVEL = LEVEL_03_XXX;
```

## 关卡设计建议

- 大星 `mass` 应明显高于地球初始质量，用来制造引力轨道。
- 小星 `mass` 应低于地球当前阶段质量，作为成长目标。
- `captureRadius` 只给大星使用，小星通常设为 `0`。
- 玩家路线应该由“等待多久喷射”决定，而不是依赖像素级碰撞。
- 每关至少提供一条可通关路线，也可以提供高分路线。

## 代码边界

- 新玩法规则优先放在 `simulation.ts`。
- 新关卡只改 `levels/`。
- 新视觉效果优先放在 `UniverseRenderer.ts`。
- 新 HUD 或菜单行为放在 `Hud.ts` 和 `styles.css`。
- 避免在渲染对象上保存玩法真相，玩法状态应以 simulation state 为准。
