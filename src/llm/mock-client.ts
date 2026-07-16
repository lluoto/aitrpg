// MockLLMClient — 离线 fallback LLM
// 当没有 API key 时使用模板响应，让游戏循环可测

import type { Message, ChatOptions } from "./client";

const SCENE_TEMPLATES: Record<string, string> = {
  arrival: `你站在普瑞米尔农场外围。夜色已深，月光透过薄云在谷仓的木板墙上投下斑驳的影子。空气中弥漫着一股淡淡的金属味，混杂着干草和泥土的气息。

前方是谷仓的正门，虚掩着。左侧有一扇破损的窗户，窗框上挂着几缕蛛网。远处传来低沉的嗡鸣声——不像是任何农用机械的声音。

西北方向隐约能看到一座小屋的轮廓，窗口透出微弱、摇曳的灯光。

你要怎么做？`,

  barn: `你走进谷仓。内部比外观看起来更宽敞，几排空荡荡的床铺沿着墙壁摆放，上面覆盖着厚厚的灰尘。干草堆散落在角落，空气中悬浮着微小的颗粒。

地面上有一些暗红色的痕迹，像是被拖拽形成的。角落里似乎有什么在动——仔细看，是一个蜷缩着的年轻人，手中紧握着一本笔记，正惊恐地看着你。

你要怎么做？`,

  cabin: `你靠近小屋。窗户透出温暖但昏暗的灯光，能听到里面有木柴燃烧的噼啪声。门半掩着，似乎主人并不在意访客。

屋内是一个简朴的生活空间：一张木床、一个炉灶、墙上挂着一把旧猎枪。桌上摊开着一本手写日记，旁边的油灯还亮着。

一个中年男人坐在桌旁抬头看你——他的眼神警惕、沉默。

你要怎么做？`,

  basement: `沿着楼梯向下，金属味越来越浓烈，几乎令人窒息。墙壁上覆盖着不规则的符号——不像任何已知的书写系统——它们微微发出暗淡的荧光。

地下室的面积比上面的谷仓大得多，这从建筑结构上说是不可能的。角落里排列着数个巨大的玻璃容器，里面悬浮着无法辨认的器官组织。一种低沉、有节奏的嗡鸣从深处传来，像是在你颅骨内振动。

你要怎么做？`,
};

const NARRATIVE_TEMPLATES: Record<string, string[]> = {
  combat_hit: [
    "你命中了目标。攻击精准而致命，对方受创后退。空气中传来一声闷响。",
    "你的攻击击中了。血液从伤口渗出，对方咬紧牙关，但并没有后退。",
  ],
  combat_miss: [
    "你的攻击落空了。对方比看起来灵活，轻松避开了你的攻势。",
    "你挥了个空——对方预判了你的动作，在你攻击前就移动了位置。",
  ],
  combat_kill: [
    "最后一击。对方颓然倒地，不再动弹。四周突然安静了下来。",
    "目标倒下了。战斗结束。你能听到自己的心跳声。",
  ],
  move: [
    "你向目标方向移动。脚下的土地松软，每一步都留下浅浅的脚印。周围的环境缓慢变化，但你保持着警觉。",
    "你谨慎地前进。视线所及之处，一切都笼罩在月光之下。远处传来细碎的声响——可能是风声，也可能不是。",
  ],
  investigate: [
    "你仔细检查了周围。在灰尘和碎石的掩盖下，你发现了一些不寻常的痕迹——它们指向一个方向。",
    "你的搜索有了结果。在看似普通的外表下，隐藏着某种刻意被掩盖的细节。你记下了这个发现。",
  ],
  default: [
    "你采取了行动。周围的环境似乎因此产生了微妙的变化——空气流动的方向变了，阴影更深了。",
    "夜色笼罩着农场，只有远处小屋的窗户透出微弱摇曳的灯光。风吹过谷仓的木板缝隙，发出低沉的呜咽。",
    "田野上一片寂静，只有你的脚步声和呼吸声打破了这份安宁。空气中弥漫着泥土和干草的气息。",
    "月亮从云层后露出一角，银色的光芒短暂地照亮了农场。你瞥见谷仓的屋顶上似乎有什么东西一闪而过。",
    "周围的虫鸣忽然停止了。短暂的寂静后，声音又恢复了——但你无法确定刚才的沉默意味着什么。",
  ],
};

function pick<T>(arr: T[]): T {
  return arr[Math.floor(Math.random() * arr.length)];
}

export class MockLLMClient {
  /** 每个 NPC 的对话轮次计数器（用于模板轮替避免重复） */
  private npcConvoCount: Map<string, number> = new Map();

  chat(messages: Message[], options?: ChatOptions): Promise<string> {
    const lastMsg = messages[messages.length - 1]?.content ?? "";

    // 开场场景
    if (lastMsg.includes("描述当前场景") || lastMsg.includes("请描述当前场景")) {
      const sysMsg = messages.find(m => m.role === "system")?.content ?? "";
      if (sysMsg.includes("普瑞米尔农场")) return Promise.resolve(SCENE_TEMPLATES.arrival);
      return Promise.resolve(pick(NARRATIVE_TEMPLATES.default));
    }

    // 叙事推进
    if (lastMsg.includes("请以 KP 的口吻描述结果")) {
      // 世界模型注入 — 不触发战斗/动作模板
      if (lastMsg.includes("世界模型上下文")) {
        return Promise.resolve(pick(NARRATIVE_TEMPLATES.default));
      }
      if (lastMsg.includes("击杀") || lastMsg.includes("死亡")) return Promise.resolve(pick(NARRATIVE_TEMPLATES.combat_kill));
      if (lastMsg.includes("受伤") || lastMsg.includes("命中")) return Promise.resolve(pick(NARRATIVE_TEMPLATES.combat_hit));
      if (lastMsg.includes("未命中") || lastMsg.includes("miss")) return Promise.resolve(pick(NARRATIVE_TEMPLATES.combat_miss));
      if (lastMsg.includes("移动")) return Promise.resolve(pick(NARRATIVE_TEMPLATES.move));
      if (lastMsg.includes("调查") || lastMsg.includes("搜索")) return Promise.resolve(pick(NARRATIVE_TEMPLATES.investigate));
      return Promise.resolve(pick(NARRATIVE_TEMPLATES.default));
    }

    // 战斗叙事（仅检查当前消息，不检查历史，避免非战斗动作重复触发）
    if (lastMsg.includes("攻击") && lastMsg.includes("命中")) {
      return Promise.resolve(pick(NARRATIVE_TEMPLATES.combat_hit));
    }

    // NPC 对话模板
    if (lastMsg.includes("对我说")) {
      // 从所有 system messages 中搜索 "你的名字: NPC_NAME" 模式
      const allSysContent = messages.filter(m => m.role === "system").map(m => m.content).join("\n");
      const nameMatch = allSysContent.match(/你的名字:\s*(\S+)/);
      const npcName = nameMatch ? nameMatch[1] : "";
      const templates: Record<string, string[]> = {
        "艾德里安": ["（沉默片刻）我不喜欢陌生人出现在这里。你们最好离开。", "这里没什么好看的。谷仓就是谷仓。", "（握紧猎枪）我不想惹麻烦，但也不会任人乱翻。"],
        "加比": ["（紧张地翻着笔记）你也是来调查的吗？导师他不见了！", "你看这个符号——这不符合任何已知的几何学！", "（声音颤抖）你应该下去看看地下室...但我不会再去第二次了。"],
        "形迹可疑的人": ["（警惕地盯着你们）你们是警察派来的？总算来人了。", "（压低声音）这几天晚上谷仓总是传来怪声，像是什么东西在地底下挠。", "我建议你们先去找艾德里安——他知道的比我多。"],
      };
      const defaultFallback = ["（疑惑地看着你）你想知道什么？", "（摇了摇头）我不太清楚情况……", "（想了想）你去小屋那边问问吧。"];
      const npcTemplates = npcName && templates[npcName] ? templates[npcName] : defaultFallback;
      // 轮替：每次对话用不同的模板，用完一轮后随机
      const count = this.npcConvoCount.get(npcName) ?? 0;
      this.npcConvoCount.set(npcName, count + 1);
      const idx = count < npcTemplates.length ? count : Math.floor(Math.random() * npcTemplates.length);
      return Promise.resolve(npcTemplates[idx]);
    }

    // NPC 主动发言
    if (lastMsg.includes("有新进展") || lastMsg.includes("进入了你的区域")) {
      return Promise.resolve("（保持沉默）");
    }

    // 场景切换
    if (lastMsg.includes("场景切换")) {
      const sceneKey = lastMsg.includes("谷仓") ? "barn" : lastMsg.includes("小屋") ? "cabin" : lastMsg.includes("地下室") ? "basement" : "default";
      return Promise.resolve(SCENE_TEMPLATES[sceneKey] ?? `你进入了新的区域。周围的景象发生了变化。`);
    }

    // 剧情事件注入
    if (lastMsg.includes("剧情节点") || lastMsg.includes("触发条件")) {
      return Promise.resolve('WAIT');
    }

    return Promise.resolve(`你观察着周围的一切。这片地方比你最初感觉的要复杂得多。`);
  }

  async *chatStream(messages: Message[], options?: ChatOptions): AsyncGenerator<string> {
    const result = await this.chat(messages, options);
    yield result;
  }
}
