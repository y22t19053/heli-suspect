/* ===== engine/01-data.js（game-core.js 行 40-340）===== */
  /* ---------------- 阵营与配色 ---------------- */
  /* MVP：每位玩家 = 一个独立阵营（角色牌决定），独立计票、独立排名。
   * 规则中的"本阵营/各阵营/阵营顺序"均按玩家维度实现。 */
  const CAMPS = [
    { id: 'red',   name: '红方律师团', color: '#D82E2F' },
    { id: 'blue',  name: '蓝方律师团', color: '#012696' },
    { id: 'green', name: '绿方律师团', color: '#01847F' },
    { id: 'gold',  name: '金方律师团', color: '#E8A418' }
  ];

  /* 6 位律师角色（被动技能，3 选 1，同时亮出；起始 ⊙ = 4）
   * 技能全部唯一：相同技能的角色已合并——原教会辩护人/科技风投与铁腕大状同为"传唤 ⊙ -1"，
   * 合并为一个基础款「平民律师」（id 沿用 iron 避免历史引用）；其余每人一个独有技能。
   * 删减：媒体顾问 / 小镇名律 / 军法顾问 / 调解律师 / 教会辩护人 / 科技风投 */
  const CHARACTERS = [
    { id: 'rookie',     name: '见习律师',   camp: 'red',   desc: '起始⊙ +2',          skill: { type: 'startMoney', v: 2 } },
    { id: 'iron',       name: '平民律师',   camp: 'blue',  desc: '传唤证人 ⊙ -1',      skill: { type: 'buyDiscount', v: 1 } },
    { id: 'tycoon',     name: '律所金主',   camp: 'gold',  desc: '换证成本 -1',        skill: { type: 'refreshDiscount', v: 1 } },
    { id: 'orator',     name: '金牌大状',   camp: 'red',   desc: '证物架多抽 1 张',    skill: { type: 'drawPlus', v: 1 } },
    { id: 'organizer',  name: '首席助理',   camp: 'green', desc: '审议时本方 +1 票',   skill: { type: 'votePlus', v: 1 } },
    { id: 'pragmatist', name: '务实派律师', camp: 'blue',  desc: '可保留 2 份证词',    skill: { type: 'lockPlus', v: 1 } }
  ];

  /* 证词技能词典（① ② ③ 分级；证据排除在亮出阶段发动）
   * 左右博弈核心：swap/shiftLeft/shiftRight 改变行内位置（环形桌，行首尾相邻）；
   * flank/rally/pivot/counsel/poach 按相邻关系增减票数——2 人局中你的牌左右都是敌方牌。
   * src：真实法律案例设计注解（叙事深度：每个技能都源自一段法庭史）。 */
  const SKILLS = {
    terrorist:   { name: '证据排除', lv: 1, when: 'reveal', desc: '亮出时：排除对方 1 份已亮出的证据（作废）', src: '米兰达诉亚利桑那州（1966）：违宪取得的证据不得采信，程序正义的基石' },
    fan:         { name: '铁杆粉丝', lv: 1, when: 'count',  desc: '审议时：本方 +1 票', src: '辛普森案旁听席的狂热分化：公众站队本身就是证据' },
    troll:       { name: '庭外抹黑', lv: 1, when: 'count',  desc: '审议时：票数最高的对方 -1 票', src: '麦卡锡听证会：先扣帽子再谈事实的舆论绞杀' },
    swap:        { name: '程序动议', lv: 1, when: 'count',  desc: '审议时：与场上任意一张其他牌互换位置', src: '辛普森案辩方的程序战：用动议拖延和重组证据呈现顺序' },
    shiftLeft:   { name: '左席联动', lv: 1, when: 'count',  desc: '审议时：与左边相邻的牌互换位置', src: '法庭座次博弈：证人席的位置决定陪审团视线' },
    shiftRight:  { name: '右席联动', lv: 1, when: 'count',  desc: '审议时：与右边相邻的牌互换位置', src: '法庭座次博弈：证人席的位置决定陪审团视线' },
    counsel:     { name: '攻守同盟', lv: 1, when: 'count',  desc: '审议时：左右都是本方牌本方 +2 票，否则相邻有本方牌本方 +1 票', src: '共同被告联合辩护：律师团互为犄角（如多被告毒品案）' },
    orator:      { name: '雄辩陈词', lv: 2, when: 'count',  desc: '审议时：本方 +1 票', src: '克拉伦斯·丹罗在猴子审判的结案陈词：演说改变陪审团心智' },
    scandal:     { name: '当庭揭短', lv: 2, when: 'count',  desc: '审议时：票数最高的对方 -1 票', src: '富尔曼警探种族录音曝光：一句脏话毁掉整个指控' },
    wave:        { name: '舆论证言', lv: 2, when: 'count',  desc: '审议时：本方 +1 票，票数最高的对方 -1 票', src: '审判与媒体的双螺旋：舆论法庭先行判决' },
    flank:       { name: '左右夹击', lv: 2, when: 'count',  desc: '审议时：相邻有本方牌则票数最高的对方 -1 票（抱团者易被夹击）', src: '双律师质证战术：正反夹击使证人自相矛盾' },
    poach:       { name: '当庭挖票', lv: 2, when: 'count',  desc: '审议时：相邻有本方牌则偷票数最高的对方 1 票（敌 -1、本方 +1）', src: '陪审团争夺战：庭外调查员的策反艺术' },
    rally:       { name: '旁听声援', lv: 2, when: 'count',  desc: '审议时：相邻有本方牌则本方 +1 票（连坐人气，分散则哑火）', src: '大审判旁听席的民意压力：观众席也是一种法庭力量' },
    idol:        { name: '明星证人', lv: 3, when: 'count',  desc: '审议时：本方 +2 票', src: '迈克尔·杰克逊案明星证人团：知名度本身就是杀伤力' },
    megaScandal: { name: '致命污点', lv: 3, when: 'count',  desc: '审议时：票数最高的对方 -2 票', src: '水门录音带：实锤证据一锤定音' },
    comeback:    { name: '绝地反击', lv: 3, when: 'count',  desc: '审议时：若本方落后，+1 票', src: '丹罗在斯科普斯案的绝地翻盘：败局中的烈士辩护' },
    pivot:       { name: '险中取胜', lv: 3, when: 'count',  desc: '审议时：若左右都是敌方牌，本方 +2 票（换位可破）', src: '四面楚歌时的孤注一掷：重罪法庭的最后一搏' },
    donor:       { name: '胜诉酬金', lv: 0, when: 'post',   desc: '结算后：本方 +1⊙', src: '风险代理（Contingency Fee）：不赢不收费的诉讼融资' },
    buyback:     { name: '收买证词', lv: 0, when: 'post',   desc: '结算后：票数最高的对方 -1⊙', src: '证人收买丑闻：历史上反复出现的伪证交易' },
    /* —— 议题/站位系（条件发动，全部卡牌特有，参数在牌面上） —— */
    tagBoost:    { name: '议题共鸣', lv: 1, when: 'count',  desc: '审议时：本方 +1 票', src: '罗伊诉韦德案式议题动员：社会议题把法庭变成战场' },
    tagHate:     { name: '舆论压制', lv: 1, when: 'count',  desc: '审议时：票数最高的对方 -1 票', src: '麦卡锡式贴标签：先定义敌人再消灭敌人' },
    edge:        { name: '端点曝光', lv: 1, when: 'count',  desc: '审议时：若本牌位于行首或行尾（辩论端点），本方 +1 票', src: '证人席首尾效应：陪审团记住第一个和最后一个证人' },
    rowL:        { name: '左席取证', lv: 1, when: 'count',  desc: '审议时：若本牌位于亮出行的左半区，本方 +1 票', src: '法庭左席心理：物理位置塑造陪审团注意力' },
    rowR:        { name: '右席取证', lv: 1, when: 'count',  desc: '审议时：若本牌位于亮出行的右半区，本方 +1 票', src: '法庭右席心理：物理位置塑造陪审团注意力' },
    leftFoe:     { name: '压制左邻', lv: 1, when: 'count',  desc: '审议时：若左邻为对方牌，该牌 -1 票', src: '质证瞄准术：只打离你最近的敌人' },
    rightFoe:    { name: '压制右邻', lv: 1, when: 'count',  desc: '审议时：若右邻为对方牌，该牌 -1 票', src: '质证瞄准术：只打离你最近的敌人' },
    majority:    { name: '人多势众', lv: 1, when: 'count',  desc: '审议时：若本方当前票数领先（含并列），本方 +1 票', src: '从众陪审心理：多数派立场自我强化' },
    minority:    { name: '逆境反扑', lv: 1, when: 'count',  desc: '审议时：若本方当前票数落后，本方 +1 票', src: '孤证翻盘史：单个勇敢的持异议陪审员改变判决' },
    shame:       { name: '借题发挥', lv: 2, when: 'count',  desc: '审议时：若场上有丑闻牌，本方 +1 票', src: '丑闻放大效应：一旦有污点，舆论自动扩散' },
    threat:      { name: '王牌对垒', lv: 2, when: 'count',  desc: '审议时：若对方有 ③ 级技能牌，票数最高的对方 -1 票', src: '王牌证人对王牌证人：世纪审判的宿命对决' },
    /* —— 封神技（真实传奇律师招牌战术，全部卡牌特有） —— */
    crossExam:     { name: '交叉询问', lv: 2, when: 'count', desc: '审议时：相邻敌方证人 -1 票；若其带丑闻，额外 -1 票', src: '佩里·梅森式质证：问题早已知道答案，只等证人自投罗网' },
    objection:     { name: '反对!', lv: 1, when: 'count', desc: '审议时：若对方本场亮出 ②/③ 级技能牌，票数最高的对方 -1 票', src: '法庭反对程序：程序正义的日常武器' },
    reasonableDoubt: { name: '合理怀疑', lv: 3, when: 'count', desc: '审议时：若对方场上证据 ≥3 份，票数最高的对方 -2 票', src: '约翰尼·科克伦的"手套论"（辛普森案）："戴不上，就无罪"' },
    timelineSnipe: { name: '时间线狙击', lv: 3, when: 'count', desc: '审议时：若对方场上带技能的证据 ≥2 份，票数最高的对方 -1 票', src: '库鲁亚马（梅南德斯案）：用商店收据时间戳击穿不在场证明' },
    flipNarrative: { name: '翻转叙事', lv: 3, when: 'count', desc: '审议时：若本方落后 ≥2 票，本方 +2 票', src: '格里·斯宾塞（红宝石山脊）：把案件从"事实之争"翻转成"原则之争"' },
    careerGamble:  { name: '职业生涯赌局', lv: 3, when: 'count', desc: '审议时：本方 +2 票；若本方未领先，则本方丑闻 +1', src: '达登的"手套试验"豪赌：赌上职业生涯的最后一击' },
    credCollapse:  { name: '证人信誉崩塌', lv: 2, when: 'count', desc: '审议时：若对方有丑闻牌，票数最高的对方 -1 票', src: '富尔曼信誉崩塌：伪证史让整条证据链作废' },
    whistleblower: { name: '内部吹哨人', lv: 0, when: 'post', desc: '结算后：丑闻最高的对方 -1⊙ 且丑闻 +1', src: '弗兰克·瑟皮科：体制内吹哨人扳倒整个系统' },
    precedent:     { name: '确立先例', lv: 3, when: 'count', desc: '审议时：本方 +1 票，并记录本方"先例"标记（终局先例胜利）', src: '曼斯菲尔德勋爵（萨默塞特案）：一次判决改变一个时代的法律' },
    juryNull:      { name: '陪审团否决', lv: 3, when: 'count', desc: '审议时：本方 +1 票并获得 1 名陪审员支持（集满 3 名立即胜诉）', src: '威廉·佩恩与曾格案：陪审团拒绝适用恶法，人民之诉' },
    /* —— 位置博弈系（做题！看清行首/行尾/半区再下注） —— */
    firstSeat:   { name: '首座质证', lv: 2, when: 'count', desc: '审议时：若行首（最左一张）是对方牌，该牌 -1 票', src: '证人席首位效应：谁坐在第一个位置，谁先被盘问' },
    lastSeat:    { name: '末席质证', lv: 2, when: 'count', desc: '审议时：若行尾（最右一张）是对方牌，该牌 -1 票', src: '末位记忆效应：陪审团对最后一个证人的印象最深' },
    leftWall:    { name: '左翼壁垒', lv: 3, when: 'count', desc: '审议时：本方所有位于行左半区的牌各 +1 票', src: '阵地战术：把整条证据链铺在陪审团视线左侧形成压迫' },
    randomHit:   { name: '抽签质证', lv: 2, when: 'count', desc: '审议时：随机 1 张对方牌 -1 票（赌运气）', src: '庭上掷骰：没有明确目标时，抽中谁算谁' }
  };
  /* 技能价值表（AI 选牌/买卖用；非列表内技能回退 2）—— 数值已按 ±1 化微调 */
  const SK_VAL = {
    fan: 2, troll: 2.2, terrorist: 2, swap: 1.6, shiftLeft: 1.4, shiftRight: 1.4, counsel: 2.6,
    orator: 2.6, scandal: 2.6, wave: 2.8, flank: 2.4, poach: 2.4, rally: 2.4, idol: 3.4, megaScandal: 3.4,
    comeback: 2.2, pivot: 3.0, donor: 2, buyback: 2.2, tagBoost: 2, tagHate: 2.2, edge: 2,
    rowL: 1.6, rowR: 1.6, leftFoe: 1.6, rightFoe: 1.6, majority: 1.6, minority: 1.6,
    shame: 2.2, threat: 2.4,
    crossExam: 3, objection: 2, reasonableDoubt: 3.8, timelineSnipe: 3.4, flipNarrative: 3.2,
    careerGamble: 3.2, credCollapse: 2.8, whistleblower: 2.4, precedent: 3.8, juryNull: 3.6,
    firstSeat: 2.2, lastSeat: 2.2, leftWall: 3.0, randomHit: 2.4
  };
  function skillVal(s) { return SK_VAL[s] !== undefined ? SK_VAL[s] : (s ? 2 : 0); }

  /* 90 张证人/证据牌模板（⊙ = 调查成本；votes = 基础采信票，默认 1；scandal = 单卡丑闻值）
   * 每张牌都有独立技能（无换名卡）：数值系（tagBoost 议题共鸣 / tagHate 舆论压制）、
   * 站位系（edge 端点 / rowL / rowR / leftFoe / rightFoe / majority / minority）、
   * 经典系（fan / troll / orator / scandal / wave / idol / megaScandal / comeback / pivot …）。 */
  const VOTER_TEMPLATES = [
    /* 基础牌（① 级数值/站位技能） */
    { id: 'v01', name: '学生证言',       cost: 1, votes: 1, skill: 'tagBoost', desc: '本方 +1 票' },
    { id: 'v02', name: '老兵证词',       cost: 1, votes: 1, skill: 'tagBoost', desc: '本方 +1 票' },
    { id: 'v03', name: '骑手证言',       cost: 1, votes: 1, skill: 'leftFoe', v: 1, desc: '若左邻为对方牌，该牌 -1 票' },
    { id: 'v04', name: '主妇证词',       cost: 2, votes: 1, skill: 'rowR', v: 1, desc: '若本牌位于亮出行右半区，本方 +1 票' },
    { id: 'v05', name: '教友证词',       cost: 2, votes: 1, skill: 'tagBoost', desc: '本方 +1 票' },
    { id: 'v06', name: '失业工人证词',   cost: 2, votes: 1, skill: 'minority', v: 1, desc: '若本方当前票数落后对方，本方 +1 票' },
    { id: 'v07', name: '码农证言',       cost: 2, votes: 1, skill: 'tagBoost', desc: '本方 +1 票' },
    { id: 'v08', name: '教授证词',       cost: 3, votes: 1, skill: 'tagBoost', desc: '本方 +1 票' },
    { id: 'v09', name: '创投人证言',     cost: 3, votes: 1, skill: 'tagBoost', desc: '本方 +1 票' },
    { id: 'v10', name: '维权者证词',     cost: 3, votes: 1, skill: 'tagBoost', desc: '本方 +1 票' },
    /* 多票基础（少数高票牌，附条件技能） */
    { id: 'v11', name: '沉默旁证',       cost: 3, votes: 2, skill: 'edge', v: 1, desc: '若本牌位于行首或行尾，本方 +1 票' },
    { id: 'v12', name: '忠诚证人',       cost: 4, votes: 2, skill: 'shame', v: 2, desc: '若场上有丑闻牌，本方 +1 票' },
    { id: 'v13', name: '王牌证人',       cost: 4, votes: 2, skill: 'threat', v: 2, desc: '若对方有 ③ 级技能牌，票数最高的对方 -1 票' },
    /* ① 级技能（亮出阶段：证据排除） */
    { id: 'v14', name: '关键反证',       cost: 3, votes: 1, skill: 'terrorist' },
    /* ① 级技能（审议时） */
    { id: 'v15', name: '狂热支持者',     cost: 2, votes: 1, skill: 'fan' },
    { id: 'v16', name: '匿名抹黑者',     cost: 2, votes: 1, skill: 'troll' },
    /* ② 级技能（审议时） */
    { id: 'v17', name: '雄辩家',         cost: 3, votes: 1, skill: 'orator' },
    { id: 'v18', name: '揭短材料',       cost: 3, votes: 1, skill: 'scandal', scandal: 1 },
    { id: 'v19', name: '舆情报告',       cost: 4, votes: 1, skill: 'wave' },
    /* ③ 级技能（审议时） */
    { id: 'v20', name: '明星证人',       cost: 4, votes: 1, skill: 'idol' },
    { id: 'v21', name: '重磅黑料',       cost: 4, votes: 1, skill: 'megaScandal', scandal: 1 },
    { id: 'v22', name: '翻盘证词',       cost: 4, votes: 1, skill: 'comeback' },
    /* 结算后技能 */
    { id: 'v23', name: '献金记录',       cost: 3, votes: 1, skill: 'donor' },
    { id: 'v24', name: '买票记录',       cost: 4, votes: 1, skill: 'buyback', scandal: 1 },
    /* ============ 数据驱动扩充包（v25+，从美式社会人群/职业列表提取） ============ */
    { id: 'v25', name: '乡村证人',       cost: 1, votes: 1, skill: 'rightFoe', v: 1, desc: '若右邻为对方牌，该牌 -1 票' },
    { id: 'v26', name: '牧师证词',       cost: 2, votes: 1, skill: 'tagBoost', desc: '本方 +1 票' },
    { id: 'v27', name: '工会领袖证词',   cost: 2, votes: 1, skill: 'rowL', v: 1, desc: '若本牌位于亮出行左半区，本方 +1 票' },
    { id: 'v28', name: '地产大亨供词',   cost: 3, votes: 1, skill: 'tagHate', desc: '票数最高的对方 -1 票' },
    { id: 'v29', name: '主妇旁证',       cost: 2, votes: 1, skill: 'tagBoost', desc: '本方 +1 票' },
    { id: 'v30', name: '移民证词',       cost: 1, votes: 1, skill: 'tagBoost', desc: '本方 +1 票' },
    { id: 'v31', name: '执事证词',       cost: 2, votes: 1, skill: 'tagBoost', desc: '本方 +1 票' },
    { id: 'v32', name: '学贷证词',       cost: 1, votes: 1, skill: 'tagBoost', desc: '本方 +1 票' },
    { id: 'v33', name: '伤残军人证词',   cost: 2, votes: 1, skill: 'tagHate', desc: '票数最高的对方 -1 票' },
    { id: 'v34', name: '店主证词',       cost: 2, votes: 1, skill: 'tagBoost', desc: '本方 +1 票' },
    { id: 'v35', name: '枪协会员证词',   cost: 2, votes: 1, skill: 'tagHate', desc: '票数最高的对方 -1 票' },
    { id: 'v36', name: '幕后金主供词',   cost: 4, votes: 2, skill: 'tagBoost', desc: '本方 +1 票' },
    { id: 'v37', name: '教师代表证词',   cost: 2, votes: 1, skill: 'tagBoost', desc: '本方 +1 票' },
    { id: 'v38', name: '石油寡头供词',   cost: 3, votes: 1, skill: 'tagHate', desc: '票数最高的对方 -1 票' },
    { id: 'v39', name: '游说者供词',     cost: 3, votes: 1, skill: 'tagHate', desc: '票数最高的对方 -1 票', scandal: 1 },
    { id: 'v40', name: '管道工证词',     cost: 1, votes: 1, skill: 'tagBoost', desc: '本方 +1 票' },
    { id: 'v41', name: '街头活动家证词', cost: 2, votes: 1, skill: 'tagBoost', desc: '本方 +1 票' },
    { id: 'v42', name: '租户证词',       cost: 1, votes: 1, skill: 'tagBoost', desc: '本方 +1 票' },
    { id: 'v43', name: '农场主证词',     cost: 2, votes: 1, skill: 'tagBoost', desc: '本方 +1 票' },
    { id: 'v44', name: '卡车司机证词',   cost: 2, votes: 1, skill: 'tagBoost', desc: '本方 +1 票' },
    { id: 'v45', name: '巡边员证词',     cost: 2, votes: 1, skill: 'tagBoost', desc: '本方 +1 票' },
    { id: 'v46', name: '诊所义工证词',   cost: 2, votes: 1, skill: 'tagBoost', desc: '本方 +1 票' },
    { id: 'v47', name: '单亲妈妈证词',   cost: 2, votes: 1, skill: 'tagBoost', desc: '本方 +1 票' },
    { id: 'v48', name: '电台主持证词',   cost: 2, votes: 1, skill: 'tagBoost', desc: '本方 +1 票' },
    { id: 'v49', name: '阴谋论者证词',   cost: 2, votes: 1, skill: 'tagBoost', desc: '本方 +1 票' },
    { id: 'v50', name: '电视布道家证词', cost: 3, votes: 1, skill: 'tagBoost', desc: '本方 +1 票' },
    { id: 'v51', name: '教师证词',       cost: 2, votes: 1, skill: 'tagBoost', desc: '本方 +1 票' },
    { id: 'v52', name: '家教家长证词',   cost: 2, votes: 1, skill: 'tagBoost', desc: '本方 +1 票' },
    { id: 'v53', name: '反疫苗者证词',   cost: 2, votes: 1, skill: 'tagHate', desc: '票数最高的对方 -1 票' },
    { id: 'v54', name: '跨性别者证词',   cost: 1, votes: 1, skill: 'tagBoost', desc: '本方 +1 票' },
    { id: 'v55', name: '权益律师证词',   cost: 3, votes: 1, skill: 'tagHate', desc: '票数最高的对方 -1 票' },
    { id: 'v56', name: '检察官证词',     cost: 3, votes: 1, skill: 'tagHate', desc: '票数最高的对方 -1 票', scandal: 1 },
    { id: 'v57', name: '强硬警长证词',   cost: 3, votes: 1, skill: 'tagBoost', desc: '本方 +1 票' },
    { id: 'v58', name: '质疑证人',       cost: 2, votes: 1, skill: 'tagHate', desc: '票数最高的对方 -1 票' },
    { id: 'v59', name: '民粹商家证词',   cost: 2, votes: 1, skill: 'tagBoost', desc: '本方 +1 票' },
    { id: 'v60', name: '保守派证词',     cost: 2, votes: 1, skill: 'majority', v: 1, desc: '若本方当前票数领先（含并列），本方 +1 票' },
    { id: 'v61', name: '社运者证词',     cost: 3, votes: 1, skill: 'tagHate', desc: '票数最高的对方 -1 票' },
    { id: 'v62', name: '自由派证人',     cost: 2, votes: 1, skill: 'tagBoost', desc: '本方 +1 票' },
    { id: 'v63', name: '民粹元老证词',   cost: 3, votes: 1, skill: 'tagBoost', desc: '本方 +1 票' },
    { id: 'v64', name: '环保青年证词',   cost: 2, votes: 1, skill: 'tagBoost', desc: '本方 +1 票' },
    /* ============ 左右博弈扩充包（v65+，换位/相邻技能） ============ */
    { id: 'v65', name: '掮客证词',       cost: 3, votes: 1, skill: 'swap' },
    { id: 'v66', name: '街头鼓动家证词', cost: 2, votes: 1, skill: 'shiftLeft' },
    { id: 'v67', name: '华尔街证人',     cost: 2, votes: 1, skill: 'shiftRight' },
    { id: 'v68', name: '社区证人',       cost: 3, votes: 1, skill: 'rally' },
    { id: 'v69', name: '顽固证人',       cost: 3, votes: 1, skill: 'flank' },
    { id: 'v70', name: '摇摆证人',       cost: 4, votes: 1, skill: 'pivot' },
    /* ============ 左右互动新技能（v89+：攻守同盟 / 当庭挖票） ============ */
    { id: 'v89', name: '并肩证人',       cost: 3, votes: 1, skill: 'counsel', desc: '左右都本方+2票；否则相邻本方+1票' },
    { id: 'v90', name: '反水线人',       cost: 3, votes: 1, skill: 'poach' },
    /* ============ 社会百态扩充包（v71+，更多美式人群/职业） ============ */
    { id: 'v71', name: '流浪者倡导证词', cost: 1, votes: 1, skill: 'tagBoost', desc: '本方 +1 票' },
    { id: 'v72', name: '交易员证词',     cost: 3, votes: 1, skill: 'tagHate', desc: '票数最高的对方 -1 票' },
    { id: 'v73', name: '医护证词',       cost: 2, votes: 1, skill: 'tagBoost', desc: '本方 +1 票' },
    { id: 'v74', name: '主播证词',       cost: 2, votes: 1, skill: 'tagBoost', desc: '本方 +1 票' },
    { id: 'v75', name: '书店老板证词',   cost: 2, votes: 1, skill: 'tagBoost', desc: '本方 +1 票' },
    { id: 'v76', name: '咖啡店员证词',   cost: 1, votes: 1, skill: 'tagBoost', desc: '本方 +1 票' },
    { id: 'v77', name: '房产经纪证词',   cost: 2, votes: 1, skill: 'tagBoost', desc: '本方 +1 票' },
    { id: 'v78', name: '军商证词',       cost: 3, votes: 1, skill: 'tagBoost', desc: '本方 +1 票' },
    { id: 'v79', name: '乡村歌手证词',   cost: 3, votes: 1, skill: 'tagBoost', desc: '本方 +1 票' },
    { id: 'v80', name: '素食者证词',     cost: 2, votes: 1, skill: 'tagHate', desc: '票数最高的对方 -1 票' },
    { id: 'v81', name: '健身教练证词',   cost: 2, votes: 1, skill: 'tagBoost', desc: '本方 +1 票' },
    { id: 'v82', name: '数据科学家证词', cost: 3, votes: 1, skill: 'tagBoost', desc: '本方 +1 票' },
    { id: 'v83', name: '快递站长证词',   cost: 1, votes: 1, skill: 'tagBoost', desc: '本方 +1 票' },
    { id: 'v84', name: '橄榄球教练证词', cost: 3, votes: 1, skill: 'tagHate', desc: '票数最高的对方 -1 票' },
    { id: 'v85', name: '币圈矿工证词',   cost: 2, votes: 1, skill: 'tagHate', desc: '票数最高的对方 -1 票', scandal: 1 },
    { id: 'v86', name: '诊所护士证词',   cost: 2, votes: 1, skill: 'tagBoost', desc: '本方 +1 票' },
    { id: 'v87', name: '古董商证词',     cost: 2, votes: 1, skill: 'tagHate', desc: '票数最高的对方 -1 票' },
    { id: 'v88', name: '算法工程师证词', cost: 3, votes: 1, skill: 'tagHate', desc: '票数最高的对方 -1 票' },
    /* ============ 封神技扩充包（v91+，真实传奇律师招牌战术） ============ */
    { id: 'v91', name: '质证记录',       cost: 3, votes: 1, skill: 'crossExam', desc: '相邻敌方证人 -1 票；若其带丑闻，额外 -1 票' },
    { id: 'v92', name: '反对理由书',     cost: 2, votes: 1, skill: 'objection', desc: '对方亮出 ②/③ 级技能牌时，票数最高的对方 -1 票' },
    { id: 'v93', name: '手套证据',       cost: 4, votes: 1, skill: 'reasonableDoubt', desc: '对方场上证据 ≥3 份时，票数最高的对方 -2 票' },
    { id: 'v94', name: '收据时间戳',     cost: 4, votes: 1, skill: 'timelineSnipe', desc: '对方场上带技能的证据 ≥2 份时，票数最高的对方 -1 票' },
    { id: 'v95', name: '原则陈词',       cost: 4, votes: 1, skill: 'flipNarrative', desc: '本方落后 ≥2 票时，本方 +2 票' },
    { id: 'v96', name: '世纪豪赌',       cost: 4, votes: 1, skill: 'careerGamble', desc: '本方 +2 票；若本方未领先，则本方丑闻 +1' },
    { id: 'v97', name: '伪证前科档案',   cost: 4, votes: 1, skill: 'credCollapse', desc: '对方有丑闻牌时，票数最高的对方 -1 票' },
    { id: 'v98', name: '吹哨人档案',     cost: 3, votes: 1, skill: 'whistleblower', desc: '结算后：丑闻最高的对方 -1⊙ 且丑闻 +1' },
    { id: 'v99', name: '先例判词',       cost: 4, votes: 1, skill: 'precedent', desc: '本方 +1 票，并记录"先例"标记（终局先例胜利）' },
    { id: 'v100', name: '人民之诉',      cost: 4, votes: 1, skill: 'juryNull', desc: '本方 +1 票并获得 1 名陪审员支持（集满 3 名立即胜诉）' },
    /* 位置博弈系（v101+）：首座/末席/左翼壁垒/抽签质证 */
    { id: 'v101', name: '首座证言',      cost: 2, votes: 1, skill: 'firstSeat', v: 1, desc: '若行首（最左）是对方牌，该牌 -1 票' },
    { id: 'v102', name: '末席证词',      cost: 2, votes: 1, skill: 'lastSeat', v: 1, desc: '若行尾（最右）是对方牌，该牌 -1 票' },
    { id: 'v103', name: '左翼方阵',      cost: 3, votes: 1, skill: 'leftWall', v: 1, desc: '本方所有位于行左半区的牌各 +1 票' },
    { id: 'v104', name: '抽签质证',      cost: 2, votes: 1, skill: 'randomHit', v: 1, desc: '随机 1 张对方牌 -1 票' }
  ];

  /* 程序性技能：黑天鹅【程序滥用】等事件判定用（动议/反对/时间线狙击/换位） */
  const PROCEDURAL_SKILLS = ['swap', 'shiftLeft', 'shiftRight', 'objection', 'timelineSnipe', 'whistleblower'];

  /* AI 人格（从美式法律/政治文化提取）：
   * aggression 0~1：进攻性（影响攻击事件偏好/出牌数量）
   * economy 0~1：经济牌偏好（影响购买/刷新决策）
   * bonus：人格被动加成（vote=审议+票 / money=每轮+⊙）——让 AI 更像"有性格的对手" */
  const AI_PERSONALITIES = [
    { id: 'libertarian',    name: '自由派律师',     icon: '🗽', aggression: 0.35, economy: 0.8, bonus: { money: 1 } },
    { id: 'teaParty',       name: '民粹律师',       icon: '🍵', aggression: 0.7,  economy: 0.45, bonus: { vote: 1 } },
    { id: 'demSoc',         name: '平权律师',       icon: '✊', aggression: 0.55, economy: 0.6 },
    { id: 'maga',           name: '鹰派律师',       icon: '🦅', aggression: 0.9,  economy: 0.35, bonus: { vote: 1 } },
    { id: 'greenNewDeal',   name: '环保律师',       icon: '🌱', aggression: 0.6,  economy: 0.55, bonus: { money: 1 } },
    { id: 'establishment',  name: '建制派律师',     icon: '🏛️', aggression: 0.5,  economy: 0.65, bonus: { money: 1 } },
    { id: 'nevertrump',     name: '温和保守律师',   icon: '🕊️', aggression: 0.3,  economy: 0.6 },
    { id: 'hollywood',      name: '名人律师',       icon: '🎬', aggression: 0.65, economy: 0.5, bonus: { vote: 1 } },
    /* ============ 更多人格扩充包（+4） ============ */
    { id: 'populist',       name: '民粹大状',       icon: '📣', aggression: 0.85, economy: 0.3,  bonus: { vote: 1 } },
    { id: 'silicon',        name: '硅谷律师',       icon: '💻', aggression: 0.4,  economy: 0.75, bonus: { money: 1 } },
    { id: 'military',       name: '军法律师',       icon: '🎖️', aggression: 0.9,  economy: 0.4,  bonus: { vote: 1 } },
    { id: 'moderate',       name: '中立律师',       icon: '⚖️', aggression: 0.3,  economy: 0.6,  bonus: { money: 1 } }
  ];

  /* 事件牌模板（lv：① ② ③ 分级；target：self 自己 / enemy 需选对方 / auto 自动） */
  const EVENT_TEMPLATES = [
    { id: 'e01', name: '当庭陈词',   lv: 1, timing: 'pre',  target: 'self',  eff: { type: 'vote', val: 1 },     desc: '庭审前：本方 +1 票' },
    { id: 'e02', name: '质疑证词',   lv: 1, timing: 'pre',  target: 'enemy', eff: { type: 'vote', val: -1 },    desc: '庭审前：指定对方 -1 票' },
    { id: 'e03', name: '追加陈词',   lv: 2, timing: 'pre',  target: 'self',  eff: { type: 'vote', val: 1 },     desc: '庭审前：本方 +1 票' },
    { id: 'e04', name: '揭发前科',   lv: 2, timing: 'pre',  target: 'enemy', eff: { type: 'vote', val: -1 },    desc: '庭审前：指定对方 -1 票' },
    { id: 'e05', name: '关键陈词',   lv: 3, timing: 'pre',  target: 'self',  eff: { type: 'vote', val: 2 },     desc: '庭审前：本方 +2 票' },
    { id: 'e06', name: '致命污点',   lv: 3, timing: 'pre',  target: 'enemy', eff: { type: 'vote', val: -2 },    desc: '庭审前：指定对方 -2 票' },
    { id: 'e07', name: '胜诉酬金',   lv: 1, timing: 'post', target: 'self',  eff: { type: 'money', val: 1 },    desc: '庭审后：本方 +1⊙' },
    { id: 'e08', name: '冻结资产',   lv: 1, timing: 'post', target: 'enemy', eff: { type: 'money', val: -1 },   desc: '庭审后：指定对方 -1⊙' },
    { id: 'e09', name: '舆论施压',   lv: 2, timing: 'post', target: 'auto',  eff: { type: 'rewardBuff', val: 1 }, desc: '庭审后：若本方本轮第一，倾向奖励 +1' },
    { id: 'e10', name: '抹黑对手',   lv: 2, timing: 'post', target: 'enemy', eff: { type: 'support', val: -1 }, desc: '庭审后：指定对方倾向 -1' },
    { id: 'e11', name: '终局陈词',   lv: 3, timing: 'post', target: 'auto',  eff: { type: 'rewardBuff', val: 2 }, desc: '庭审后：若本方本轮第一，倾向奖励 +2' },
    { id: 'e12', name: '庭外交易',   lv: 3, timing: 'post', target: 'enemy', eff: { type: 'support', val: -2 }, desc: '庭审后：指定对方倾向 -2' },
    { id: 'e21', name: '环境污染案',    lv: 2, timing: 'pre',  target: 'auto', eff: { type: 'scandalAll', val: 1 },               desc: '庭审前：所有玩家丑闻值 +1' },
    { id: 'e34', name: '禁酒令案',      lv: 1, timing: 'post', target: 'auto', eff: { type: 'scandalAll', val: 1 },               desc: '庭审后：所有玩家丑闻值 +1' },
    { id: 'e36', name: '反恐案',        lv: 2, timing: 'post', target: 'auto', eff: { type: 'scandalAll', val: 1 },               desc: '庭审后：所有玩家丑闻值 +1' },
    { id: 'e37', name: '军售丑闻案',    lv: 2, timing: 'post', target: 'auto', eff: { type: 'scandalAll', val: 1 },               desc: '庭审后：所有玩家丑闻值 +1' },
    { id: 'e38', name: '桃色丑闻案',    lv: 3, timing: 'post', target: 'auto', eff: { type: 'scandalAll', val: 1 },               desc: '庭审后：所有玩家丑闻值 +1' },
    { id: 'e40', name: '计票争议案',    lv: 1, timing: 'post', target: 'auto', eff: { type: 'scandalAll', val: 1 },              desc: '庭审后：所有玩家丑闻值 +1' },
    { id: 'e41', name: '水门案',        lv: 3, timing: 'post', target: 'auto', eff: { type: 'scandalAll', val: 1 },              desc: '庭审后：所有玩家丑闻值 +1' },
    /* ============ 法庭黑天鹅扩充包（e55+，基于行为模式触发，不进事件牌堆） ============
     * 触发机制：不看轮次随机，而是看玩家「行为模式」——由 checkBlackSwan 在庭审前检查
     *   s.stats.roundXxx（本轮已亮出牌的构成）与 leaderStreak（连续领跑轮数）
     * 三种影响设计（每只黑天鹅都具备）：
     *   ① 立即生效   → immediate() 立刻结算（票/⊙/丑闻/支持度）
     *   ② 可被抵消   → counter() 若满足条件（持有特定技能牌）则免疫并反转叙事
     *   ③ 永久改变规则 → perma() 写入 state.permaRules，此后每轮生效（收入税/罚款/票差惩罚） */
    { id: 'e55', name: '疲劳轰炸', lv: 3, timing: 'auto', target: 'auto', blackSwan: true,
      trigger: (st, s) => s.stats.roundPlayed >= 3,
      counter: (st, s) => s.hand.some(c => c.skill === 'flipNarrative'),
      counterText: '叙事大师掌控节奏，法官采信其陈词节奏，疲劳指控被当庭驳回',
      immediate: (st, s) => { st.voteMod[s.seat] -= 1; st.logs.push('🦢 黑天鹅【疲劳轰炸】：' + st.seats[s.seat].name + ' 疲劳举证，证人证词前后矛盾——本轮 -1 票'); },
      perma: (st, s) => { st.permaRules.fatigueTax = st.permaRules.fatigueTax || {}; st.permaRules.fatigueTax[s.seat] = true; st.logs.push('📜 永久规则：' + st.seats[s.seat].name + ' 此后每轮收入 -1⊙（超负荷庭审开销）'); },
      desc: '庭审记录：连日盘问令证人形容枯槁，书记员逐字核对证词时发现多处矛盾……' },
    { id: 'e56', name: '媒体围猎', lv: 3, timing: 'auto', target: 'auto', blackSwan: true,
      trigger: (st, s) => s.stats.roundScandal >= 2,
      counter: (st, s) => s.hand.some(c => c.skill === 'whistleblower'),
      counterText: '内部吹哨人主动交代内幕，媒体焦点转向制度本身，围猎化解',
      immediate: (st, s) => { for (let i = 0; i < st.seatCount; i++) applyScandalEffects(st, i); st.logs.push('🦢 黑天鹅【媒体围猎】：丑闻证据外泄引发媒体狂欢——所有玩家丑闻 +1'); },
      perma: (st, s) => { st.permaRules.mediaHunt = st.permaRules.mediaHunt || {}; st.permaRules.mediaHunt[s.seat] = true; st.logs.push('📜 永久规则：' + st.seats[s.seat].name + ' 此后每张丑闻牌 -1 票（名声尽毁，越描越黑）'); },
      desc: '庭审记录：庭审笔记经人泄露登上头版，旁听席座无虚席，陪审团不时瞥向记者席……' },
    { id: 'e57', name: '程序滥用', lv: 3, timing: 'auto', target: 'auto', blackSwan: true,
      trigger: (st, s) => s.stats.roundProcedural >= 2,
      counter: (st, s) => s.hand.some(c => c.skill === 'objection'),
      counterText: '法官认定反对有理有据，程序异议全部成立，罚款豁免',
      immediate: (st, s) => { st.seats[s.seat].money = Math.max(0, st.seats[s.seat].money - 2); st.logs.push('🦢 黑天鹅【程序滥用】：' + st.seats[s.seat].name + ' 滥用程序动议拖延庭审——被处藐视法庭罚款 2⊙'); },
      perma: (st, s) => { st.permaRules.proceduralTax = st.permaRules.proceduralTax || {}; st.permaRules.proceduralTax[s.seat] = true; st.logs.push('📜 永久规则：' + st.seats[s.seat].name + ' 此后每打出 1 张程序牌额外 -1⊙（罚款升级）'); },
      desc: '庭审记录：休庭期间，主审法官在法官席后摇头——"本庭无意容忍无休止的动议轰炸。"……' },
    { id: 'e58', name: '证人疲劳', lv: 3, timing: 'auto', target: 'auto', blackSwan: true,
      trigger: (st, s) => s.stats.roundWitness >= 3,
      counter: (st, s) => s.hand.some(c => c.skill === 'crossExam'),
      counterText: '交叉询问当场澄清矛盾，证人可信度不降反升',
      immediate: (st, s) => { st.voteMod[s.seat] -= 1; st.logs.push('🦢 黑天鹅【证人疲劳】：' + st.seats[s.seat].name + ' 连传多名证人，证词相互矛盾——本轮 -1 票'); },
      perma: (st, s) => { st.permaRules.witnessFatigue = st.permaRules.witnessFatigue || {}; st.permaRules.witnessFatigue[s.seat] = true; st.logs.push('📜 永久规则：' + st.seats[s.seat].name + ' 此后每张证人牌 -1 票（证人名声已然透支）'); },
      desc: '庭审记录：第四位证人走上证人席时，陪审团席传来一声几不可闻的叹息……' },
    { id: 'e59', name: '树大招风', lv: 3, timing: 'auto', target: 'auto', blackSwan: true,
      trigger: (st, s) => st.leaderStreak >= 2 && st.prevFirst === s.seat,
      counter: (st, s) => s.hand.some(c => c.skill === 'reasonableDoubt'),
      counterText: '以合理怀疑转移舆论焦点，领跑者反而赢得"受害者光环"',
      immediate: (st, s) => { st.seats[s.seat].support = Math.max(0, st.seats[s.seat].support - 1); st.logs.push('🦢 黑天鹅【树大招风】：' + st.seats[s.seat].name + ' 连续领跑成为众矢之的——陪审团倾向 -1'); },
      perma: (st, s) => { st.permaRules.underdogBonus = true; st.logs.push('📜 永久规则：此后每轮，落后 ≥2 票的一方获得 +1 票补偿（陪审团倒向弱者）'); },
      desc: '庭审记录：法庭外抗议者高呼领跑方律师的名字，陪审团入场时神情各异……' }
  ];

