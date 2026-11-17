import type { Translation } from "../catalog";
import type { EnglishMessages } from "./en";
import { emailZh } from "./email.zh";
import { pagesZh } from "./pages.zh";

/**
 * Simplified Chinese (ADR 0094). Machine-drafted without a paid service; a
 * native-speaking player reviews it before launch (docs/i18n.md). Friendly
 * and casual ("你"), with the game words in the glossary there.
 */
export const zh: Translation<EnglishMessages> = {
  shell: {
    brand: "足垒球联赛",
    skipToContent: "跳到正文",
    siteNav: "网站",
    header: {
      nav: "主导航",
      schedule: "赛程",
      standings: "积分榜",
      events: "活动",
      faq: "常见问题",
      join: "加入",
      signIn: "登录或打开应用",
      menu: "菜单",
      close: "关闭",
      more: "更多",
    },
    footer: {
      schedules: "赛程",
      history: "历史",
      about: "关于我们",
      events: "活动",
      faq: "常见问题",
      contact: "联系我们",
      friends: "朋友们",
      help: "帮助",
      park: "McCarren 公园",
      rules: "规则",
      sponsors: "赞助商",
      signIn: "登录或打开应用",
    },
    theme: {
      toLight: "切换到浅色模式",
      toDark: "切换到深色模式",
    },
    language: {
      group: "语言",
      current: "{language}（当前）",
      report: "发现翻译有误或不通顺？告诉联赛",
    },
  },
  profile: {
    language: {
      label: "语言",
      hint: "邮件和通知会用这个语言发送。应用的界面暂时还是英文。",
      saved: "已保存。以后的邮件和通知会用{language}发送。",
      save: "保存语言",
    },
  },
  formats: {
    teams: { $plural: { other: "{n} 支球队" } },
    players: { $plural: { other: "{n} 名球员" } },
  },
  faq: {
    title: "常见问题",
    description:
      "需要自己组队吗？男女混合吗？费用多少、穿什么、下雨怎么办？关于布鲁克林成人足垒球的快速解答。",
    home: "首页",
    headingStart: "你的问题，",
    headingSwipe: "这里有答案",
    intro: "简单来说：男女混合，可以一个人来，也没人要求你踢得好。",
    sections: "常见问题分类",
    readyTitle: "随时欢迎你",
    readyBody: "用你的邮箱登录，就可以注册球队、加入球队，或者一个人报名。",
    signUp: "报名参加赛季",
    joining: {
      title: "加入",
      team: {
        question: "我需要有球队才能加入吗？",
        answer:
          "不需要。以自由球员身份报名，联赛会在赛季开始前把你分到一支球队。很多人都是一个人来的，这也是认识新朋友最快的方式。",
      },
      friend: {
        question: "怎么加入朋友的球队？",
        answer:
          "向你的队长要球队的邀请链接。打开链接，用邮箱登录，签署免责声明；如果球队分摊费用，再付你的那一份。就这样，你已经在名单上了。",
      },
      age: {
        question: "多大年龄可以参加？",
        answer:
          "年满 18 岁就可以参加比赛。有些在酒吧举办的社交活动要求年满 21 岁，活动页面会写清楚。",
      },
      skill: {
        question: "我需要很会踢足垒球吗？",
        answer:
          "完全不用。只要你还记得小时候课间玩的游戏，就够格了。比赛气氛友好，裁判会解释判罚，踢空了也没人在意。",
      },
    },
    season: {
      title: "赛季",
      when: {
        question: "比赛在什么时候？",
        answer:
          "取决于赛季和公园的场地许可：夏季是周日下午，春秋季是工作日晚上。每个赛季的页面会在开放报名前公布具体日期和时间。",
      },
      where: {
        question: "在哪里比赛？",
        answer:
          "在布鲁克林的 McCarren 公园，位于 Greenpoint 和 Williamsburg 交界处。你的比赛页面会写明你的场地。",
        more: "怎么去 McCarren 公园",
      },
      cost: {
        question: "要花多少钱？",
        answer:
          "费用每个赛季确定一次，在你付款之前就会显示在赛季页面上，并说明包含哪些内容。有的赛季按人收费，有的按队收费。球队分摊费用时，每位球员在网上付自己的那一份。",
      },
      length: {
        question: "一场比赛多长时间？",
        answer:
          "每场比赛都在一小时内结束，所以你还来得及吃晚饭，或者和队友喝一杯（或来一杯气泡水）。",
      },
      coed: {
        question: "联赛是男女混合的吗？",
        answer:
          "是的。每支球队都是混合组队，阵容要符合联赛的性别平衡规则，你的队长和裁判会留意这一点。",
      },
      rain: {
        question: "下雨怎么办？",
        answer:
          "联赛会有专人关注天气预报并做决定，通常在前一天。如果你的比赛因雨取消，比赛页面会显示出来；补赛时间确定后也会显示在那里。",
      },
    },
    gameDay: {
      title: "比赛日",
      wear: {
        question: "我该穿什么？",
        answer:
          "运动鞋或碎钉鞋，穿一件你们球队颜色的衣服，晚上的比赛再带件外套。夏天记得带水和防晒霜。",
      },
      drink: {
        question: "我一定要喝酒吗？",
        answer:
          "不用。赛后一起玩是乐趣的一部分，但喝酒还是喝气泡水由你决定，很多人也会直接回家。城市公园里不允许饮酒，所以饮料要等比赛结束后再说。",
      },
      watch: {
        question: "朋友可以来看比赛吗？",
        answer: "当然可以。这是公共公园，场边多几个球迷只会让大家踢得更带劲。",
      },
    },
  },
  schedule: {
    title: "赛程",
    seasonTitle: "{season} 赛程",
    divisionTitle: "{division} 赛程",
    namedTitle: "{name}：{season} 赛程",
    thisWeek: "跳到本周",
    seasonNav: "赛季",
    standings: "积分榜",
    playoffs: "季后赛",
    statusLabel: "比赛日状态",
    divisionsNav: "分组",
    allDivisions: "所有分组",
    comingSoon: "即将公布",
    comingSoonBody:
      "赛程大约在开幕日前一周公布。现在报名，赛程上线时我们会发邮件通知你。",
    team: "球队",
    allTeams: "所有球队",
    show: "显示",
    teamPage: "{team} 的球队页面和日历",
    showingTeam: {
      $plural: { other: "显示 {name} 的 {n} 场比赛。" },
    },
    showingAll: {
      $plural: { other: "显示全部 {n} 场比赛。" },
    },
    themeWeek: "主题周：",
    open: "空场",
    crossover: "跨组赛",
    makeups: "待安排的补赛",
    makeupsBody:
      "这些比赛需要新的日期。联赛一定下日期，就会显示在这里、球队页面和日历订阅中。",
    kickoff: "开赛",
    fieldTba: "场地待定",
    timeTba: "时间待定",
  },
  gameStatus: {
    ruling: "裁定",
    cancelled: "已取消",
    postponed: "已延期",
    rainedOut: "因雨取消",
    final: "终场",
    forfeit: "弃权",
    live: "直播中",
  },
  gameday: {
    updated: "更新于 {time}",
    gamesOn: "比赛照常进行。",
    watchingDay: "正在关注天气：我们会在 {time} 前决定。",
    someLate: "部分比赛推迟开始。",
    allLate: "所有比赛推迟开始。",
    someOff: "部分比赛取消。",
    allOff: "所有比赛取消。",
    watchingGame: "正在关注天气：{time} 前决定",
    startsLate: "推迟开始：{time}",
    off: "取消",
  },
  ruleSet: {
    bestOf: "{n} 局 {n} 胜制",
    daylight: "日落前 {minutes} 分钟结束比赛",
    innings: { $plural: { other: "{n} 局" } },
    timeLimit: "限时 {minutes} 分钟",
    bunting: "允许触击",
    noBunting: "不允许触击",
    stealing: "允许盗垒",
    noStealing: "不允许盗垒",
  },
  home: {
    title: "{site} · 布鲁克林男女混合成人足垒球",
    sticker: "布鲁克林 McCarren 公园 ☀️",
    heroStart: "踢踢球，认识你最喜欢的",
    heroSwipe: "新朋友。",
    intro:
      "布鲁克林的成人男女混合足垒球，专为那些从小学课间之后就没再玩过的人准备。带上你的球队，或者一个人来，我们帮你找队。赛后留下来喝一杯（或来一杯气泡水）。",
    signUp: "报名参加赛季",
    questions: "有问题？这里有答案",
    basics: "基本信息",
    facts: {
      what: {
        term: "是什么",
        detail: "成人男女混合足垒球。比赛友好，积分认真。",
      },
      where: {
        term: "在哪里",
        detail: "McCarren 公园，在 Greenpoint 和 Williamsburg 之间。",
        link: "怎么去",
      },
      when: {
        term: "什么时候",
        detail: "夏季周日下午；春秋季工作日晚上。",
        link: "赛程和积分榜",
      },
      price: {
        term: "价格",
        detail: "每个赛季确定，付款前就能看到。球队可以分摊费用。",
        link: "费用怎么算",
      },
    },
    waysIn: "三种加入方式",
    ways: {
      team: {
        title: "带上你的球队",
        body: "以队长身份注册，在群聊里分享一个邀请链接，每个人自己报名、付自己的那一份。",
      },
      friend: {
        title: "加入朋友的球队",
        body: "打开队长的邀请链接，签署免责声明，你就在名单上了。",
      },
      solo: {
        title: "一个人来",
        body: "以自由球员身份报名，我们帮你分到一支球队。认识新朋友本身就是一半的乐趣。",
        link: "个人报名怎么操作",
      },
    },
    afterTitle: "比赛只是一半",
    afterBody:
      "球队赛后常常一起玩，每个赛季都以季后赛收尾，大多数人都会交到几个新朋友。没人非得喝酒，也没人非得踢得好。",
    aboutLink: "更多关于联赛",
    photos: "最近的赛场瞬间",
    opensPost: "（在 Instagram 打开帖子）",
    newHere: "第一次玩足垒球，或刚来布鲁克林？",
    newHereLinks: {
      howToPlay: "足垒球怎么玩",
      elsewhere: "从纽约其他地方过来参加",
      solo: "没有球队怎么加入",
    },
    league: {
      description: "{league}：赛季、赛程、积分榜、球队和活动。",
      intro:
        "{league} 的赛季、赛程、积分榜和活动。用你在本网站任何联赛使用的同一个账号报名。",
      seasons: "赛季",
      noSeasons: "第一个赛季的赛程公布后会显示在这里。",
      schedule: "赛程",
      standings: "积分榜",
      more: "{league} 的更多内容",
      events: "活动",
      sponsors: "赞助商",
      history: "联赛历史",
      records: "纪录",
    },
  },
  ...pagesZh,
  email: emailZh,
};
