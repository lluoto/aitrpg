// 普瑞米尔的谷仓 — 模组数据结构
// 基于原始 PDF 解析，转为 KP Agent 可用的结构化数据
import type { ModuleData } from "./types";

export const BARN_OF_PREMIER: ModuleData = {
  id: "barn-of-premier",
  title: "普瑞米尔的谷仓",
  version: "1.03",
  ruleset: "coc7e",
  era: "1921",
  summary: "调查员接受菲碧·特里坎的委托，调查她失踪的儿子加比。随着调查深入，发现这背后隐藏着一个涉及绑架、非法医学实验和超自然力量的巨大阴谋。",

  meta: {
    author: "未知",
    playerCount: "2-3人",
    expectedDuration: "短模组（一次团）",
    triggerWarnings: ["绑架", "非法医学实验", "超自然恐怖", "身体恐怖", "尸体描述"],
    bgmHints: {
      trailor: "昏暗小镇，蝉鸣，远处偶尔狗吠",
      bar: "嘈杂的爵士乐，酒杯碰撞声",
      hospital: "冷凝的医疗器械滴答声",
      barn: "阴森的嗡鸣，机械呼吸声",
      sewer: "滴水声，低沉的风声",
      final: "低频嗡鸣，接近时的尖锐声",
    },
  },

  endings: [
    {
      id: "true_end",
      name: "True End",
      description: "调查员解救所有受害者，击退米-戈，将艾米丽和爱莉的缸中脑安置在安全之处。",
      conditions: ["完成所有场景调查", "找到农场", "发现下水道", "击退米-戈"],
      sanReward: "3d6",
      cmReward: 3,
    },
    {
      id: "good_end",
      name: "Good End",
      description: "调查员报警解救了受害者，但未能深入下水道探索真相。",
      conditions: ["找到农场", "报警救人"],
      sanReward: "1d6",
      cmReward: 1,
    },
    {
      id: "bad_end",
      name: "Bad End",
      description: "调查员未能找到关键线索，加比和其他受害者未被及时找到。",
      conditions: [],
      sanReward: "0",
      cmReward: 0,
    },
  ],

  scenes: [
    // ===== 序幕 / 委托 =====
    {
      id: "prologue",
      name: "序幕：特里坎家",
      order: 0,
      description: "菲碧·特里坎（Phoebe Tricam）的家，一个普通的工人家庭住宅。客厅里有陈旧但干净的家具，墙上挂着家人的照片。窗外可以看到一辆白色拖车。",
      atmosphere: "焦灼、不安。母亲的眼神透露出深深的绝望。",
      clues: [
        {
          id: "clue_client_mission",
          name: "委托任务",
          description: "菲碧·特里坎的委托——寻找她17岁的儿子加比，他已经失踪了半个月。",
          findMethods: [{ type: "automatic", description: "菲碧主动告诉你" }],
          revelation: "加比·特里坎，17岁，半个月前失踪。菲碧已经报警，但当地警察无所作为。她指向窗外——加比平时住的白色拖车。",
          unlocks: ["clue_trailor", "clue_photo"],
          found: false,
          importance: "core",
        },
        {
          id: "clue_photo",
          name: "加比的照片",
          description: "墙上的家庭照中有一个头发染成蓝色、打着唇钉的少年——加比。",
          findMethods: [
            { type: "observation", description: "观察客厅墙上的照片" },
          ],
          revelation: "加比留着蓝色染发，有唇钉，穿着宽松的街头服饰。看起来是个典型的叛逆青少年。照片中还有菲碧和一个中年男子的合影。",
          unlocks: [],
          found: false,
          importance: "color",
        },
      ],
      npcIds: ["phoebe_tricam"],
      connections: [
        { targetSceneId: "trailor", condition: "前往加比的拖车" },
      ],
      bgmHint: "quiet_tense",
      imageHint: "a modest 1920s working-class living room, warm lamp light, family photos on wall",
    },

    // ===== 加比的拖车 =====
    {
      id: "trailor",
      name: "加比的拖车",
      order: 1,
      description: "一辆白色的老式拖车，停在后院。车门虚掩着，推开车门，一股混合着霉味、大麻和廉价香水的气味扑面而来。狭小的空间杂乱无章。",
      atmosphere: "乱糟糟的少年房间——音乐碟片、乐队海报、空啤酒罐、披萨盒散落各处。床上被褥凌乱。卫生间里有简单的洗漱用品。",
      clues: [
        {
          id: "clue_pistol",
          name: "床底的手枪",
          description: "一个黑色帆布袋，里面是一把1911手枪和几个装满子弹的弹匣。",
          findMethods: [
            { type: "skill", skillName: "spot_hidden", difficulty: "regular", description: "检查床底" },
          ],
          revelation: "一把Colt M1911手枪，保养良好，序列号已被锉平。弹匣装满0.45 ACP子弹。加比从哪里搞到的？这把枪属于非法持有。",
          unlocks: [],
          found: false,
          importance: "core",
        },
        {
          id: "clue_bar_card",
          name: "维森酒吧邀请卡",
          description: "一张小卡片，印着\"维森酒吧——狂欢之夜——凭此卡入场\"，背后手写了一个日期（上周五）。",
          findMethods: [
            { type: "skill", skillName: "spot_hidden", difficulty: "regular", description: "检查餐桌上的披萨盒" },
            { type: "observation", description: "随意翻动桌上的杂物" },
          ],
          revelation: "维森酒吧的VIP邀请卡。上周五的日期。看来加比最近经常出入酒吧。",
          unlocks: ["clue_bar_witness"],
          found: false,
          importance: "core",
        },
        {
          id: "clue_drugs",
          name: "毒品",
          description: "卫生间水箱后面藏着一小包白色粉末和几个空胶囊。",
          findMethods: [
            { type: "skill", skillName: "spot_hidden", difficulty: "regular", description: "仔细搜查卫生间" },
          ],
          revelation: "大约10克可卡因和几个空的凝胶胶囊。加比不只是个叛逆青少年——他可能涉足毒品交易。或者他只是个使用者。",
          unlocks: [],
          found: false,
          importance: "bonus",
        },
        {
          id: "clue_phone_note",
          name: "电话留言",
          description: "一部老式电话机旁边有一个便签本，最近一页被撕掉了，留有笔压痕迹。",
          findMethods: [
            { type: "skill", skillName: "spot_hidden", difficulty: "hard", description: "用铅笔在便签本上涂画显出笔压" },
          ],
          revelation: "通过铅笔涂抹，显出一行字：\"艾德里安——老地方——带\"货\"\"。",
          unlocks: ["clue_adrian_name"],
          found: false,
          importance: "core",
        },
      ],
      npcIds: [],
      connections: [
        { targetSceneId: "bar", condition: "前往维森酒吧" },
        { targetSceneId: "prologue", condition: "返回菲碧处询问更多信息" },
      ],
      skillChecks: [
        { skill: "spot_hidden", difficulty: "regular", purpose: "发现隐藏线索" },
        { skill: "spot_hidden", difficulty: "hard", purpose: "发现电话留言笔压" },
      ],
      bgmHint: "messy_room_ambient",
    },

    // ===== 维森酒吧 =====
    {
      id: "bar",
      name: "维森酒吧",
      order: 2,
      description: "小镇边缘的一家破旧酒吧。霓虹灯招牌一闪一灭。推开沉重的木门，烟味、酒味和汗味扑面而来。吧台后面一个魁梧的酒保正在擦杯子。角落里几个潦倒的酒客。",
      atmosphere: "嘈杂、烟雾弥漫。一个中年酒保警惕地看着你。",
      clues: [
        {
          id: "clue_bar_witness",
          name: "酒保的证言",
          description: "酒保认识加比。他透露上周有阔佬包场开了狂欢派对。",
          findMethods: [
            { type: "skill", skillName: "persuade", difficulty: "regular", description: "说服酒保说出信息" },
            { type: "skill", skillName: "fast_talk", difficulty: "regular", description: "用话术套话" },
            { type: "skill", skillName: "intimidate", difficulty: "hard", description: "恐吓酒保" },
          ],
          revelation: "酒保透露：上周有个阔佬包下了整个酒吧办派对，加比也在场。那个阔佬是\"艾德里安先生\"——一个经常光顾的外地人，开着好车，出手阔绰。派对结束后就没再见过加比。",
          unlocks: ["clue_adrian_identity"],
          found: false,
          importance: "core",
        },
        {
          id: "clue_bar_add",
          name: "附近居民的见闻",
          description: "蹲在酒吧门口的一个流浪汉可能看到了什么。",
          findMethods: [
            { type: "skill", skillName: "persuade", difficulty: "hard", description: "说服流浪汉开口" },
            { type: "skill", skillName: "fast_talk", difficulty: "regular", description: "话术或给小费" },
          ],
          revelation: "流浪汉说：\"哦，你说那个蓝头发的小子？上周我看到他上了一辆黑色的轿车，开车的是个体面人。他们往郊外方向去了。\"",
          unlocks: ["clue_car_direction"],
          found: false,
          importance: "bonus",
        },
      ],
      npcIds: ["bartender", "tramp"],
      connections: [
        { targetSceneId: "newsstand", condition: "前往报亭查阅新闻" },
        { targetSceneId: "adrian_house", condition: "找到艾德里安的地址" },
        { targetSceneId: "trailor", condition: "返回拖车寻找更多线索" },
      ],
      bgmHint: "noisy_jazz_bar",
    },

    // ===== 报亭 =====
    {
      id: "newsstand",
      name: "报亭/图书馆",
      order: 3,
      description: "小镇的公共图书馆，或者街角的报亭。可以查阅旧报纸和公共记录。",
      atmosphere: "安静，书香和灰尘的气味。",
      clues: [
        {
          id: "clue_adrian_identity",
          name: "艾德里安的身份",
          description: "通过旧报纸找到关于艾德里安·埃斯特鲁姆的报道。",
          findMethods: [
            { type: "skill", skillName: "library_use", difficulty: "regular", description: "搜索旧报纸数据库" },
          ],
          revelation: "艾德里安·埃斯特鲁姆（Adrian Estrum），38岁，生物学教授。曾服役于美军，有创伤后应激障碍记录。上周在国道附近因绑架未遂被捕，交火中导致1死2伤、1名警员殉职。目前因头部弹片伤在霍姆斯医院接受治疗，伤势严重，意识不清。",
          unlocks: ["clue_hospital", "clue_adrian_address"],
          found: false,
          importance: "core",
        },
      ],
      npcIds: ["librarian"],
      connections: [
        { targetSceneId: "hospital", condition: "前往霍姆斯医院探望艾德里安" },
        { targetSceneId: "adrian_house", condition: "前往艾德里安的住宅" },
        { targetSceneId: "bar", condition: "返回维森酒吧" },
      ],
      bgmHint: "quiet_library",
    },

    // ===== 霍姆斯医院 =====
    {
      id: "hospital",
      name: "霍姆斯医院",
      order: 4,
      description: "小镇唯一的医院，一栋洗白的二层楼房。门口有警员把守——艾德里安是重要的羁押嫌犯。消毒水的气味弥漫在走廊里。",
      atmosphere: "苍白、冰冷。消毒水气味。警员警惕的目光。",
      clues: [
        {
          id: "clue_hospital",
          name: "艾德里安的病房",
          description: "艾德里安半昏迷地躺在病床上，头上缠着绷带。他偶尔喃喃自语。",
          findMethods: [
            { type: "skill", skillName: "persuade", difficulty: "hard", description: "说服警员放行" },
            { type: "skill", skillName: "fast_talk", difficulty: "hard", description: "编造身份骗过警员" },
          ],
          revelation: "艾德里安半昏迷，偶尔喃喃自语：\"艾米丽……爱莉……对不起……保护她们……谷仓……下水道……\"这些只言片语暗示着某个地点——他的农场谷仓和下水道。",
          unlocks: ["clue_psychology"],
          found: false,
          importance: "core",
        },
        {
          id: "clue_psychology",
          name: "精神分析",
          description: "对艾德里安进行精神分析，让他短暂清醒。",
          findMethods: [
            { type: "skill", skillName: "psychology", difficulty: "hard", description: "精神分析让他清明片刻" },
            { type: "skill", skillName: "psychoanalysis", difficulty: "hard", description: "深度精神分析" },
          ],
          revelation: "艾德里安短暂清醒，抓住调查员的手：\"谷仓……我买的农场……在郊外……艾米丽和爱莉在那里……她们需要帮助……下面……下水道里有东西……\"然后再次陷入昏迷。",
          unlocks: ["scene_farm"],
          found: false,
          importance: "core",
        },
      ],
      npcIds: ["adrian_estrum", "police_guard"],
      connections: [
        { targetSceneId: "adrian_house", condition: "前往艾德里安的住宅" },
        { targetSceneId: "newsstand", condition: "返回报亭查阅地址" },
      ],
      bgmHint: "hospital_ambient",
    },

    // ===== 艾德里安的住宅 =====
    {
      id: "adrian_house",
      name: "艾德里安的住宅",
      order: 5,
      description: "艾德里安在小镇租住的房子，一栋普通的二层小楼。门前有几个流浪汉占据了门廊。窗帘紧拉。",
      atmosphere: "被遗弃的感觉。门口有流浪汉。窗户后面似乎有人影闪过。",
      clues: [
        {
          id: "clue_farm_deed",
          name: "农场转购协议",
          description: "艾德里安书桌抽屉里的文件——证明他在郊外秘密购买了一个农场。",
          findMethods: [
            { type: "skill", skillName: "spot_hidden", difficulty: "regular", description: "搜查书房/卧室" },
          ],
          revelation: "一份农场转购协议，日期是三个月前。艾德里安以现金购买了一个郊外的废弃农场，附有谷仓和土地。签名处还有一份附属文件——来自\"克劳德·罗宾斯\"的水管改造收据。",
          unlocks: ["scene_farm"],
          found: false,
          importance: "core",
        },
        {
          id: "clue_german_manuscript",
          name: "法文/德语文稿",
          description: "一本厚厚的手稿，用德语（或法语）写成，内容涉及神秘学。",
          findMethods: [
            { type: "skill", skillName: "occult", difficulty: "regular", description: "鉴定书稿内容" },
            { type: "skill", skillName: "language_other", difficulty: "regular", description: "翻译外语文稿" },
          ],
          revelation: "这是一本关于米-戈（Mi-Go）联络术的翻译手稿，从一本古老的德文法典翻译而来。其中包括召唤米-戈的仪式、缸中脑保存技术、以及\"与遥远星辰对话\"的方法。边缘有艾德里安的手写批注。",
          unlocks: ["clue_mi_go"],
          found: false,
          importance: "core",
        },
        {
          id: "clue_family_photo",
          name: "全家福",
          description: "一张照片——艾德里安、一位女性和一个小女孩。",
          findMethods: [
            { type: "observation", description: "客厅中倒扣的相框" },
          ],
          revelation: "照片中的女性（艾米丽）和小女孩（爱莉）看起来幸福地笑着。背后写着\"我们的天堂——2009年夏\"。但根据记录，艾德里安没有登记的妻子或孩子。她们是谁？",
          unlocks: [],
          found: false,
          importance: "bonus",
        },
      ],
      npcIds: ["bums", "claude_robins"],
      connections: [
        { targetSceneId: "farm", condition: "前往郊外农场" },
        { targetSceneId: "hospital", condition: "返回医院" },
      ],
      bgmHint: "abandoned_house",
    },

    // ===== 艾德里安的农场 =====
    {
      id: "farm",
      name: "艾德里安的农场",
      order: 6,
      description: "郊外一个偏僻的废弃农场。主屋破败不堪，但谷仓看起来被修缮过——新的铁皮屋顶，门上挂着粗重的锁链。周围的草丛中有隐蔽的捕兽夹。空气中有一股淡淡的化学气味和……甜腻的腐烂味。",
      atmosphere: "荒凉、隐秘。风吹过杂草，偶尔能听到从谷仓方向传来的低沉嗡鸣声。",
      clues: [
        {
          id: "clue_trap",
          name: "捕兽夹",
          description: "谷仓周围草丛中隐蔽放置的捕兽夹——有人不想让不速之客接近。",
          findMethods: [
            { type: "skill", skillName: "spot_hidden", difficulty: "regular", description: "观察草丛" },
            { type: "skill", skillName: "survival", difficulty: "regular", description: "野外生存辨识危险" },
          ],
          revelation: "三个大型捕兽夹，用链子固定在木桩上。锈迹斑斑但保养良好。如果有人踩上去，腿骨会当场折断。必须小心避开。",
          unlocks: [],
          found: false,
          importance: "bonus",
        },
        {
          id: "clue_barn_door",
          name: "谷仓防盗门",
          description: "谷仓的门是重型防盗门，需要钥匙或从内部打开。屋顶有通风口可以翻入。",
          findMethods: [
            { type: "observation", description: "检查谷仓入口" },
          ],
          revelation: "防盗门需要专业工具才能撬开。但屋顶有一扇松动的通风口栅栏——体型正常的人可以钻进去，然后从内部开门。",
          unlocks: ["scene_barn"],
          found: false,
          importance: "core",
        },
      ],
      npcIds: [],
      connections: [
        { targetSceneId: "barn", condition: "进入谷仓" },
      ],
      skillChecks: [
        { skill: "spot_hidden", difficulty: "regular", purpose: "发现捕兽夹" },
        { skill: "dodge", difficulty: "regular", purpose: "躲避捕兽夹" },
        { skill: "mechanical_repair", difficulty: "hard", purpose: "撬开防盗门" },
      ],
      bgmHint: "wind_ambient_mechanical_hum",
      imageHint: "abandoned farm at dusk, rusty barn, overgrown weeds, chain-link fence",
    },

    // ===== 谷仓内部 =====
    {
      id: "barn",
      name: "谷仓",
      order: 7,
      description: "谷仓内部被彻底改造。八张行军床整齐排列，六个人躺在上面。他们的上半身被一个奇怪的仪器罩住——透明的罩子连接着管道和一台维持生命的机器。仪器发出有节奏的嘶嘶声和嗡鸣。门口附近有一具已经死亡的尸体。",
      atmosphere: "令人窒息的恐怖。机械呼吸声、药水味。尸体已经开始腐败。",
      clues: [
        {
          id: "clue_victims",
          name: "受害者状态",
          description: "六名受害者——气管被切开，连接着呼吸机。靠着营养液维持生命。",
          findMethods: [
            { type: "skill", skillName: "medicine", difficulty: "regular", description: "检查受害者" },
          ],
          revelation: "所有受害者的气管都被整齐切开，插入呼吸管。他们的血液中检测到高浓度镇静剂。其中一人是加比·特里坎——他还活着，但处于深度昏迷。这些人的身份和绑匪毫无关联——他们是被随机选择的。",
          unlocks: ["clue_victim_id"],
          found: false,
          importance: "core",
        },
        {
          id: "clue_dead_body",
          name: "门口的尸体",
          description: "一具已经死亡的尸体，死亡时间大约一周。",
          findMethods: [
            { type: "observation", description: "检查尸体" },
            { type: "skill", skillName: "medicine", difficulty: "regular", description: "尸检" },
            { type: "skill", skillName: "forensic", difficulty: "hard", description: "法医鉴定" },
          ],
          revelation: "死者大约40岁，男性，死于失血过多——他的气管也被切开了，但不知为何没有接上呼吸机。也许是手术失败，也许是太晚被带来。身份不明。",
          unlocks: [],
          found: false,
          importance: "bonus",
        },
        {
          id: "clue_control_room",
          name: "中控室",
          description: "谷仓深处的一个隔间，堆满了医疗设备和监控仪器。红色警报灯闪烁。",
          findMethods: [
            { type: "observation", description: "探索谷仓内部" },
          ],
          revelation: "控制室里有一台大型生命维持机器——旁边有氧气罐、流食袋、药品柜。机器显示：氧气将在12小时内耗尽。如果不补充，所有受害者都会死。储物柜里有备用氧气瓶和流食。",
          unlocks: ["clue_oxygen"],
          found: false,
          importance: "core",
        },
        {
          id: "clue_oxygen",
          name: "更换氧气",
          description: "需要迅速更换氧气瓶和补充流食。",
          findMethods: [
            { type: "skill", skillName: "first_aid", difficulty: "regular", description: "操作医疗设备" },
            { type: "skill", skillName: "medicine", difficulty: "hard", description: "理解设备并操作" },
          ],
          revelation: "成功更换氧气瓶和补充流食——受害者们的状态稳定下来。还有大约48小时的时间去寻找真相。",
          unlocks: ["clue_secret_door"],
          found: false,
          importance: "core",
        },
        {
          id: "clue_secret_door",
          name: "暗门",
          description: "谷仓的角落有一个隐蔽的活板门，通往地下。",
          findMethods: [
            { type: "skill", skillName: "spot_hidden", difficulty: "hard", description: "仔细搜查谷仓后发现暗门" },
          ],
          revelation: "一个被干草掩盖的活板门。拉开后是一道绳梯，深入地下——通往废弃的下水道系统。暗门下隐约传来……女人的歌声和婴儿的啼哭？",
          unlocks: ["scene_sewer"],
          found: false,
          importance: "core",
        },
      ],
      npcIds: ["gabe_tricam"],
      connections: [
        { targetSceneId: "adrian_bedroom", condition: "探索艾德里安的卧室（谷仓旁小屋）" },
        { targetSceneId: "sewer", condition: "通过暗门进入下水道" },
      ],
      bgmHint: "mechanical_breathing",
    },

    // ===== 艾德里安的卧室（谷仓旁） =====
    {
      id: "adrian_bedroom",
      name: "艾德里安的卧室",
      order: 8,
      description: "谷仓旁边的一个小隔间——艾德里安在这里生活。简陋的床铺、衣物、一个上了锁的枪柜、一张书桌。",
      atmosphere: "军事化整洁，与谷仓的混乱形成鲜明对比。",
      clues: [
        {
          id: "clue_gun_safe",
          name: "枪柜",
          description: "上锁的枪柜，里面有：3把手枪、1把冲锋枪、1把步枪、1把霰弹枪。",
          findMethods: [
            { type: "skill", skillName: "mechanical_repair", difficulty: "hard", description: "撬开柜门" },
            { type: "skill", skillName: "lockpick", difficulty: "hard", description: "撬锁" },
            { type: "observation", description: "在艾德里安身上找钥匙" },
          ],
          revelation: "大量的武器弹药——这远远超出了个人防卫的需求。艾德里安在准备什么？或者……他在恐惧什么？",
          unlocks: [],
          found: false,
          importance: "bonus",
        },
        {
          id: "clue_journal",
          name: "艾德里安的日记",
          description: "一本日记本，记录了艾德里安的心路历程。",
          findMethods: [
            { type: "observation", description: "搜查书桌" },
          ],
          revelation: "日记揭示了一切：艾德里安的妻子艾米丽和女儿爱莉在一次车祸中重伤。他求助于神秘学，与米-戈（The Mi-Go）取得了联系。米-戈承诺可以\"保存\"他的家人——通过将她们的大脑转移到培养缸中。但手术需要大量的人类大脑作为\"引导\"。艾德里安开始绑架无辜者，用他们的大脑\"训练\"米-戈的技术。但他开始怀疑自己是否被利用了。",
          unlocks: ["clue_mi_go_truth"],
          found: false,
          importance: "core",
        },
      ],
      npcIds: [],
      connections: [
        { targetSceneId: "sewer", condition: "通过活板门进入下水道" },
      ],
      bgmHint: "personal_tragedy",
    },

    // ===== 下水道 =====
    {
      id: "sewer",
      name: "废弃下水道",
      order: 9,
      description: "顺着绳梯爬下约6米，进入一个废弃的排水隧道。混凝土墙壁，齐膝深的污水。空气中弥漫着令人作呕的气味。隧道壁上安装着新的电缆——直通深处。远处传来隐约的暖黄色灯光。",
      atmosphere: "黑暗、潮湿、闷热。偶尔有不知名生物在水面下掠过。腐烂的气味越来越浓。",
      clues: [
        {
          id: "clue_sewer_bodies",
          name: "下水道中的尸体",
          description: "三具被丢弃的尸体，头盖骨被整齐切开，大脑被取走。",
          findMethods: [
            { type: "observation", description: "探索下水道" },
          ],
          revelation: "三具尸体——全部是年轻的流浪者，身份不明。他们的头盖骨被极其精准地切开（像是用激光手术刀），大脑被完整取出。切口边缘没有任何工具痕迹。",
          unlocks: [],
          found: false,
          importance: "core",
        },
        {
          id: "clue_sewer_sound",
          name: "歌声与婴儿哭",
          description: "从下水道深处传来的轻柔女声和婴儿啼哭。",
          findMethods: [
            { type: "observation", description: "聆听" },
          ],
          revelation: "声音从一个上锁的铁门后传来。女声在哼唱摇篮曲——温柔、甜美，完全不像这个地狱般的地方该有的声音。婴儿的哭声则带着令人心碎的无助。",
          unlocks: ["scene_repair_room"],
          found: false,
          importance: "core",
        },
      ],
      npcIds: [],
      connections: [
        { targetSceneId: "repair_room", condition: "打开铁门继续深入" },
      ],
      skillChecks: [
        { skill: "spot_hidden", difficulty: "hard", purpose: "发现隐蔽的通道" },
        { skill: "listen", difficulty: "regular", purpose: "辨别声音来源" },
      ],
      bgmHint: "dripping_water_distant_lullaby",
    },

    // ===== 维修间 / 真相 =====
    {
      id: "repair_room",
      name: "维修间——真相",
      order: 10,
      description: "一个被改造为手术室/实验室的宽敞空间。房间中央有两个巨大的玻璃缸，里面充满淡黄色的营养液。一大一小两个人类大脑在液体中浮动，连接着无数的电极和管道。角落里有一个工业冰柜——打开后，是艾米丽和爱莉的身体，被完美保存着。",
      atmosphere: "诡异而令人心碎。暖黄色的灯光。营养液的微弱气泡声。母性温柔的歌声回荡在空间中——从缸中脑传出。",
      clues: [
        {
          id: "clue_mi_go_truth",
          name: "真相：米-戈的欺骗",
          description: "艾米丽的缸中脑揭示了真相。",
          findMethods: [
            { type: "automatic", description: "进入维修间后自然揭示" },
          ],
          revelation: "艾米丽的意识存在于缸中脑中。她通过某种未知方式可以与访客交流——声音直接出现在调查员的脑海中。她告诉调查员：米-戈欺骗了艾德里安。艾米丽和爱莉根本不需要变成缸中脑——她们的车祸伤本可以治愈。但米-戈想要她们的大脑——因为她们的大脑有罕见的\"共鸣特质\"，是完美的知识容器。艾德里安被利用了。",
          unlocks: ["clue_mi_go_fight"],
          found: false,
          importance: "core",
        },
        {
          id: "clue_emily_body",
          name: "艾米丽和爱莉的身体",
          description: "冰柜中的两具身体——艾米丽（约35岁）和爱莉（约4岁）。",
          findMethods: [
            { type: "observation", description: "打开冰柜" },
          ],
          revelation: "两具身体保存完好，皮肤还有弹性。她们看起来就像在沉睡。如果不是因为胸前没有呼吸起伏，你几乎以为她们还活着。艾米丽手上戴着婚戒。爱莉怀里抱着一只破旧的玩具熊。",
          unlocks: [],
          found: false,
          importance: "color",
        },
        {
          id: "clue_mi_go_fight",
          name: "米-戈降临",
          description: "管道传来嗡鸣，米-戈出现了——粉红色、5英尺高、展开膜翼、节肢动物般的躯体上顶着蟹状的头颅。它来带走艾米丽的缸中脑。",
          findMethods: [
            { type: "automatic", description: "触发最终事件" },
          ],
          revelation: "米-戈发现调查员后发起攻击或尝试抢夺缸中脑。它不会拼死战斗——如果受到足够伤害，它会从管道逃走。它留下话：\"这个大脑有罕见的共鸣价值……杀了太可惜了。\"",
          unlocks: [],
          found: false,
          importance: "core",
        },
      ],
      npcIds: ["emily_jianzhongnao", "ailee_jianzhongnao"],
      connections: [],
      bgmHint: "eternal_sadness_otherworldly_hum",
      imageHint: "dimly lit underground chamber, two massive glass tanks with preserved brains, medical equipment, industrial freezer",
    },
  ],

  npcs: [
    {
      id: "phoebe_tricam",
      name: "菲碧·特里坎",
      role: "委托者——加比的母亲",
      description: "一位憔悴的中年女性，40岁左右，穿着朴素的家居服。双眼红肿，显然已经哭了很久。她说话时声音颤抖，但努力保持镇定。",
      personality: {
        traits: ["焦虑", "慈爱", "坚强"],
        speech: "语速快，带着焦虑，经常欲言又止",
        attitude: "对调查员充满希望，愿意配合一切可能的调查",
      },
      knowledge: ["加比最近变了很多，不爱说话，经常半夜出门", "加比平时住在那辆白色拖车里，就在后院", "加比的朋友我不太认识，好像有一帮城里的混混"],
      secrets: [],
      sceneId: "prologue",
      behaviors: [
        { trigger: "player_approach", action: "主动上前迎接调查员，哀求他们帮忙找儿子" },
        { trigger: "clue_found", detail: "找到加比位置", action: "泣不成声地感谢" },
      ],
      portraitHint: "middle-aged tired woman, red-eyed from crying, standing in doorway of modest home, 1920s clothing",
    },
    {
      id: "bartender",
      name: "酒保",
      role: "维森酒吧的酒保",
      description: "一个魁梧的光头中年男性，穿着白色围裙。表情冷漠，眼神警惕。擦酒杯的动作机械而熟练。",
      personality: {
        traits: ["警惕", "多疑", "守规矩"],
        speech: "简短，不喜欢多说，除非得到好处",
        attitude: "对陌生人警惕，对熟客相对友善",
      },
      knowledge: ["艾德里安先生嘛，三十多岁，穿得很体面，开好车", "他开一辆黑色轿车，看起来挺贵的", "他隔几周就来包一次场，出手很大方", "加比那小子是常客，最近来得更勤了"],
      secrets: ["艾德里安曾付给他封口费"],
      sceneId: "bar",
      behaviors: [
        { trigger: "player_approach", action: "冷漠地打量来者，问他们要喝什么" },
        { trigger: "specific_action", detail: "付钱或说服成功", action: "压低声音分享信息" },
      ],
      voiceHint: "gruff_middle_aged_male",
    },
    {
      id: "tramp",
      name: "流浪汉",
      role: "酒吧门口的流浪者",
      description: "衣服破烂的中年男子，浑身酒气。蹲在酒吧侧面的巷子里，眼神涣散但偶尔闪过一丝精明的光。",
      personality: {
        traits: ["狡猾", "需要好处才开口", "观察力敏锐"],
        speech: "含糊不清，但关键信息清晰",
        attitude: "只要给钱就给信息",
      },
      knowledge: ["上周看到蓝发少年上了艾德里安的车", "那车是黑色的，锃亮，好像是城里来的"],
      secrets: ["他曾偷偷跟着那辆车去过郊外"],
      sceneId: "bar",
      portraitHint: "disheveled homeless man, dirty coat, sitting in alley, 1920s",
    },
    {
      id: "librarian",
      name: "图书管理员",
      role: "公共图书馆管理员",
      description: "一位头发花白的老太太，戴着金丝眼镜。她非常熟悉小镇的每一份报纸和记录。",
      personality: {
        traits: ["友善", "健谈", "熟悉本地"],
        speech: "温和，喜欢慢慢说话",
        attitude: "乐于帮助",
      },
      knowledge: ["我可以教你怎么查报刊索引，很方便的", "这个小镇的历史还挺有意思的，一百多年前这里只是个驿站", "关于艾德里安·埃斯特鲁姆这个人，我查到了一些东西"],
      secrets: [],
      sceneId: "newsstand",
    },
    {
      id: "adrian_estrum",
      name: "艾德里安·埃斯特鲁姆",
      role: "生物学教授 / 绑架犯",
      description: "一个38岁的男性，半张脸缠着绷带。即使昏迷中也眉头紧锁，偶尔抽搐。他的右手无名指上有一枚朴素的婚戒。",
      personality: {
        traits: ["聪明", "绝望", "执著", "被利用"],
        speech: "昏迷中喃喃自语，短暂清醒时语速急促",
        attitude: "对调查员不会敌对，表现出悔恨和恐惧",
      },
      knowledge: ["农场在郊外废弃的那个……我开的车……", "谷仓下面有活板门……通往下水道……", "那些东西不是地球的……它们骗了我……", "大脑取出……培养液……手术流程我记得很清楚……", "他们的氧气撑不了多久了……要快……"],
      secrets: ["他意识到自己被米-戈欺骗了", "他不想伤人，但为了家人什么都愿意做"],
      sceneId: "hospital",
      portraitHint: "bandaged man in hospital bed, military-style short hair, haunted expression",
    },
    {
      id: "police_guard",
      name: "警员",
      role: "医院门卫——负责看管艾德里安",
      description: "一名年轻的警员，站姿笔直，非常重视自己的职责。",
      personality: {
        traits: ["尽责", "严肃", "按规定办事"],
        speech: "官方语气，不易通融",
        attitude: "对陌生人警惕，对上级服从",
      },
      knowledge: ["艾德里安是危险嫌犯，上级交代过不能放任何人进去", "非授权人员不能进入病房，这是规定"],
      secrets: [],
      sceneId: "hospital",
    },
    {
      id: "bums",
      name: "流浪汉们",
      role: "占据艾德里安住宅门廊的流浪者",
      description: "三四个无家可归的流浪汉，占据了门廊。他们看起来并不凶恶，但也不想被赶走。",
      personality: {
        traits: ["虚张声势", "怕麻烦"],
        speech: "粗鲁但胆怯",
        attitude: "看人下菜碟",
      },
      knowledge: ["这房子没人住，空了好久了", "我们就找个地方睡觉，没干啥坏事"],
      secrets: [],
      sceneId: "adrian_house",
    },
    {
      id: "claude_robins",
      name: "克劳德·罗宾斯",
      role: "小镇修理匠",
      description: "一个看起来五十多岁的修理匠，手上有油污。他是镇上唯一的水管工。",
      personality: {
        traits: ["健谈", "好奇心强", "爱管闲事"],
        speech: "话多，喜欢聊别人的事",
        attitude: "友善但八卦",
      },
      knowledge: ["我去过那个农场修水管", "艾德里安让我在地下装了些奇怪的管道和接头", "那农场地下有个大房间，我偷偷看了一眼——全是医疗设备"],
      secrets: ["他偷听到艾德里安在打电话提到\"大脑\"和\"培养液\""],
      sceneId: "adrian_house",
    },
    {
      id: "gabe_tricam",
      name: "加比·特里坎",
      role: "失踪少年（受害者）",
      description: "17岁的少年，头发染成蓝色（现在已褪色），有唇钉。他躺在谷仓的行军床上，上半身被医疗仪器罩住，处于深度昏迷状态。",
      personality: {
        traits: ["N/A（昏迷）"],
        speech: "无",
        attitude: "无",
      },
      knowledge: [],
      secrets: [],
      sceneId: "barn",
    },
    {
      id: "emily_jianzhongnao",
      name: "艾米丽（缸中脑）",
      role: "艾德里安的妻子 / 缸中脑",
      description: "一个漂浮在淡黄色培养液中的大脑。通过未知方式，调查员可以\"听到\"她的声音——温柔、悲伤，充满了母性。",
      personality: {
        traits: ["温柔", "悲伤但不绝望", "母爱深沉"],
        speech: "声音直接出现在脑海，轻柔，带有一丝电子音质感",
        attitude: "感激调查员到来，只关心女儿爱莉",
      },
      knowledge: ["米-戈骗了我的丈夫……它们说能救我和爱莉", "它们想要我的大脑，因为我有罕见的共鸣特质", "下水道有出口……在镇子东边的废弃泵站", "它们害怕高频声波和强光"],
      secrets: ["她知道爱莉的大脑已经被米-戈复制了数据", "米-戈来自猎户座"],
      sceneId: "repair_room",
    },
    {
      id: "ailee_jianzhongnao",
      name: "爱莉（缸中脑）",
      role: "艾德里安的女儿 / 缸中脑",
      description: "一个较小的缸中脑，在隔壁的培养缸中。时不时发出婴儿般的脑波——表现为\"啼哭\"或\"咯咯笑\"。",
      personality: {
        traits: ["婴儿心智", "对母亲的声音有反应"],
        speech: "无法用语言交流，通过脑波表达情绪",
        attitude: "对母亲的声音感到安心",
      },
      knowledge: [],
      secrets: [],
      sceneId: "repair_room",
    },
  ],
};

/** 获取模块中所有场景的 ID 列表 */
export function getSceneIds(): string[] {
  return BARN_OF_PREMIER.scenes.map((s) => s.id);
}

/** 按 ID 获取场景 */
export function getSceneById(id: string) {
  return BARN_OF_PREMIER.scenes.find((s) => s.id === id);
}

/** 按 ID 获取 NPC */
export function getNpcById(id: string) {
  return BARN_OF_PREMIER.npcs.find((n) => n.id === id);
}

/** 获取初始场景 ID */
export function getInitialSceneId(): string {
  return BARN_OF_PREMIER.scenes[0].id;
}
