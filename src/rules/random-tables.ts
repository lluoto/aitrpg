// ============================================================
// 随机表引擎 — 可编程随机内容生成
// ============================================================

interface WeightedEntry {
  weight: number;
  value: string | string[];
}

interface RandomTable {
  name: string;
  desc: string;
  method: "pick" | "compose";
  entries: WeightedEntry[];
}

// ── 工具函数 ──────────────────────────────────────────────

function weightedPick(entries: WeightedEntry[]): string {
  const total = entries.reduce((s, e) => s + e.weight, 0);
  let r = Math.random() * total;
  for (const e of entries) {
    r -= e.weight;
    if (r <= 0) return resolveValue(e.value);
  }
  return resolveValue(entries[0].value);
}

function pickOne(arr: string[]): string {
  return arr[Math.floor(Math.random() * arr.length)];
}

/** entry.value 可以是单个词条，也可以是候选列表；两种都要收敛成一个字符串。 */
function resolveValue(value: string | string[]): string {
  return Array.isArray(value) ? pickOne(value) : value;
}

// ── 随机表注册表 ──────────────────────────────────────────

const registry = new Map<string, RandomTable>();

function registerTable(table: RandomTable) {
  registry.set(table.name, table);
}

export function listTables(): { name: string; desc: string }[] {
  return Array.from(registry.values()).map(t => ({ name: t.name, desc: t.desc }));
}

export function rollTable(name: string, count = 1): string[] {
  const table = registry.get(name);
  if (!table) throw new Error(`未知随机表: ${name}\n可用: ${Array.from(registry.keys()).join(", ")}`);

  const results: string[] = [];
  for (let i = 0; i < count; i++) {
    if (table.method === "pick") {
      results.push(weightedPick(table.entries));
    } else {
      // compose: 每个 entry 独立掷，可能组合
      const parts: string[] = [];
      for (const e of table.entries) {
        if (Math.random() * 100 < e.weight) parts.push(resolveValue(e.value));
      }
      // 所有 entry 都没掷中时回退到加权抽取，而不是把 WeightedEntry 当字符串数组去索引。
      results.push(parts.join("") || weightedPick(table.entries));
    }
  }
  return results;
}

// ============================================================
// 内置随机表
// ============================================================

registerTable({
  name: "chinese-name", desc: "中国姓名",
  method: "compose",
  entries: [
    { weight: 100, value: ["李", "王", "张", "刘", "陈", "杨", "赵", "黄", "周", "吴", "徐", "孙", "马", "胡", "朱", "郭", "何", "高", "林", "罗"] },
    { weight: 100, value: ["伟", "芳", "娜", "敏", "静", "丽", "强", "磊", "军", "洋", "勇", "艳", "杰", "涛", "明", "超", "秀", "霞", "平", "刚"] },
  ],
});

registerTable({
  name: "western-name", desc: "西方姓名",
  method: "compose",
  entries: [
    { weight: 100, value: ["James", "John", "Robert", "Michael", "William", "David", "Richard", "Joseph", "Thomas", "Charles", "Mary", "Patricia", "Jennifer", "Linda", "Barbara", "Elizabeth", "Susan", "Jessica", "Sarah", "Karen"] },
    { weight: 100, value: ["Smith", "Johnson", "Williams", "Brown", "Jones", "Garcia", "Miller", "Davis", "Rodriguez", "Martinez", "Hernandez", "Lopez", "Gonzalez", "Wilson", "Anderson", "Thomas", "Taylor", "Moore", "Jackson", "Martin"] },
  ],
});

registerTable({
  name: "tavern-name", desc: "酒馆名称",
  method: "compose",
  entries: [
    { weight: 100, value: ["醉", "老", "迷雾", "弯刀", "龙息", "夜莺", "锚", "断剑", "乌鸦", "星", "旅人", "狼", "金币", "蛇", "翡翠"] },
    { weight: 100, value: ["酒馆", "客栈", "旅店", "酒吧", "小屋", "酒窖", "大厅", "角落", "休息处", "避难所"] },
  ],
});

registerTable({
  name: "npv-quirk", desc: "NPC 怪癖",
  method: "pick",
  entries: [
    { weight: 5, value: "总是用第三人称谈论自己" },
    { weight: 5, value: "对数字极其敏感，对话中一直计数" },
    { weight: 5, value: "不由自主地模仿对话者的语气" },
    { weight: 5, value: "房间里所有东西必须对齐" },
    { weight: 4, value: "谈话时一直玩弄硬币" },
    { weight: 4, value: "记不住名字，给每人取外号" },
    { weight: 3, value: "坚信自己曾是皇室成员" },
    { weight: 3, value: "每次看到乌鸦都会行礼" },
    { weight: 3, value: "认为镜子会偷走灵魂，拒绝照镜子" },
    { weight: 2, value: "能听到不存在的声音——而且它们会告诉他秘密" },
    { weight: 2, value: "从来不睡觉，但也从不疲倦" },
    { weight: 1, value: "每次回答问题前都要掷一枚硬币" },
    { weight: 1, value: "总是带着一条别人看不见的狗" },
  ],
});

registerTable({
  name: "loot-trinket", desc: "小饰品 / 杂物战利品",
  method: "pick",
  entries: [
    { weight: 5, value: "一枚刻有奇怪符号的黄铜戒指" },
    { weight: 5, value: "半瓶廉价的威士忌" },
    { weight: 5, value: "一把折断的银钥匙" },
    { weight: 4, value: "一张褪色的家庭照片" },
    { weight: 4, value: "一枚锈迹斑斑的硬币，来自未知文明" },
    { weight: 3, value: "一包发霉的烟草" },
    { weight: 3, value: "一只塞着软木塞的小玻璃瓶，里面是黑色液体" },
    { weight: 3, value: "一本用看不懂的文字写的小册子" },
    { weight: 2, value: "一面巴掌大的银镜，背面刻着拉丁文" },
    { weight: 2, value: "一颗看起来像眼球的玛瑙石" },
    { weight: 2, value: "一封未寄出的信，信纸边缘有烧焦的痕迹" },
    { weight: 1, value: "一个嗡嗡作响的小金属球" },
    { weight: 1, value: "一卷神秘的羊皮纸地图" },
    { weight: 1, value: "一段绑着人类头发的绳子" },
  ],
});

registerTable({
  name: "loot-valuable", desc: "贵重战利品",
  method: "pick",
  entries: [
    { weight: 10, value: "金币 x1d6 枚" },
    { weight: 8, value: "银制怀表（约值 $15）" },
    { weight: 6, value: "一枚红宝石戒指（约值 $30）" },
    { weight: 4, value: "一把镶有宝石的匕首（约值 $50）" },
    { weight: 3, value: "一封银行本票（$100）" },
    { weight: 2, value: "一部1928年版《死灵书》节选" },
    { weight: 1, value: "一颗拳头大的未切割蓝宝石" },
    { weight: 1, value: "古老的金制雕像，雕刻内容蠕动着" },
  ],
});

registerTable({
  name: "encounter-urban", desc: "城市随机遭遇",
  method: "pick",
  entries: [
    { weight: 8, value: "一个醉汉摇摇晃晃地撞过来" },
    { weight: 6, value: "街头报童大喊着耸人听闻的标题" },
    { weight: 5, value: "一个戴着圆顶礼帽的陌生人似乎一直在跟踪你" },
    { weight: 4, value: "一只黑猫从巷子里窜出，打翻了一堆垃圾" },
    { weight: 3, value: "一辆黑色轿车缓缓驶过，车窗摇下，里面一片漆黑" },
    { weight: 2, value: "警察在拦人盘查，正朝你的方向走来" },
    { weight: 2, value: "街角有一个街头艺术家，画着你——但他从未抬头看过你" },
    { weight: 1, value: "一个穿着20年前旧衣服的人向你走来，叫出了你的名字" },
    { weight: 1, value: "远处传来一声非人的尖啸，但路人似乎都没听到" },
  ],
});

registerTable({
  name: "encounter-rural", desc: "乡野随机遭遇",
  method: "pick",
  entries: [
    { weight: 8, value: "一只受惊的鹿从灌木丛中窜出" },
    { weight: 6, value: "路边有一辆抛锚的福特T型车，引擎盖敞开" },
    { weight: 5, value: "远处传来猎枪的回响" },
    { weight: 4, value: "一个农民赶着一群羊穿过小路" },
    { weight: 3, value: "草丛中有什么东西在沙沙作响" },
    { weight: 2, value: "路牌被人拧歪了，指向错误的方向" },
    { weight: 2, value: "一片寂静——虫鸣、鸟叫全部消失了" },
    { weight: 1, value: "一个稻草人站在田里——它刚才是不是朝你转头了？" },
  ],
});

registerTable({
  name: "weather", desc: "天气",
  method: "pick",
  entries: [
    { weight: 10, value: "晴朗，微风" },
    { weight: 8, value: "阴天，闷热" },
    { weight: 6, value: "细雨绵绵" },
    { weight: 5, value: "浓雾弥漫，能见度极低" },
    { weight: 4, value: "暴雨倾盆" },
    { weight: 3, value: "狂风呼啸，树枝折断" },
    { weight: 2, value: "大雪纷飞" },
    { weight: 1, value: "天空泛着不自然的黄绿色——风暴来临的征兆" },
  ],
});

registerTable({
  name: "room-dressing", desc: "房间装饰 / 环境细节",
  method: "pick",
  entries: [
    { weight: 5, value: "墙角堆着发黄的旧报纸" },
    { weight: 5, value: "天花板上有一片可疑的水渍" },
    { weight: 4, value: "壁炉里的灰烬还微微发烫" },
    { weight: 4, value: "书桌上散落着墨迹未干的笔记" },
    { weight: 3, value: "墙上挂着一幅面部被割掉的肖像画" },
    { weight: 3, value: "地板上有一道深深的划痕，像是被什么拖拽过" },
    { weight: 2, value: "空气中弥漫着淡淡的硫磺味" },
    { weight: 2, value: "窗户被用木板钉死了——从外面" },
    { weight: 1, value: "角落里放着一面被黑布盖住的落地镜" },
    { weight: 1, value: "房间里的一切都被一层细细的白粉覆盖" },
  ],
});

registerTable({
  name: "rumor", desc: "谣言 / 传闻",
  method: "pick",
  entries: [
    { weight: 5, value: "据说老码头附近每晚都能听到婴儿哭声" },
    { weight: 5, value: "镇上那个医生半夜总是提着黑包出门" },
    { weight: 4, value: "有一批从埃及运来的木乃伊在海关不翼而飞" },
    { weight: 4, value: "图书馆的禁书区有人在偷偷翻阅不该看的书" },
    { weight: 3, value: "上个月失踪的渔民被发现时——据说样子完全变了" },
    { weight: 2, value: "铁路隧道的第13个标段，挖到了一些不该挖到的东西" },
    { weight: 2, value: "有人在地下室发现了一扇不应该存在的门" },
    { weight: 1, value: "新来的那个神父从来不在白天出现" },
    { weight: 1, value: "教堂尖塔上的钟，在午夜会多敲一下" },
  ],
});

registerTable({
  name: "book", desc: "神秘 / 禁忌书籍",
  method: "pick",
  entries: [
    { weight: 10, value: "一本普通的19世纪小说，但其中某些页码被泪水浸透" },
    { weight: 6, value: "一本拉丁文版的《恶魔学入门》Prolegomena Daemonologia" },
    { weight: 4, value: "《无名祭祀书》Unaussprechlichen Kulten——德语第一版" },
    { weight: 3, value: "《塞拉伊诺断章》Celaeno Fragments——英文译本手稿" },
    { weight: 2, value: "阿卜杜拉·阿尔哈萨德的《死灵书》——17世纪拉丁文节选" },
    { weight: 2, value: "一份用象形文字写在莎草纸上的古埃及文本" },
    { weight: 1, value: "《蠕动混沌》——作者署名处只有一团不停变化的黑色墨迹" },
  ],
});

// 初始化日志
console.log(`[random-tables] ${registry.size} 张随机表已加载`);
