import type { Translation } from "../catalog";
import type { EnglishMessages } from "./en";
import { emailKo } from "./email.ko";
import { pagesKo } from "./pages.ko";

/**
 * Korean (ADR 0094). Machine-drafted without a paid service; a
 * native-speaking player reviews it before launch (docs/i18n.md). Friendly
 * polite speech (해요체), with the game words in the glossary there.
 */
export const ko: Translation<EnglishMessages> = {
  shell: {
    brand: "킥볼 리그",
    skipToContent: "본문으로 건너뛰기",
    siteNav: "사이트",
    footer: {
      schedules: "일정",
      history: "역사",
      about: "리그 소개",
      events: "이벤트",
      faq: "자주 묻는 질문",
      contact: "문의",
      friends: "친구들",
      help: "도움말",
      park: "McCarren Park",
      rules: "규칙",
      sponsors: "스폰서",
      signIn: "로그인",
    },
    theme: {
      toLight: "라이트 모드로 전환",
      toDark: "다크 모드로 전환",
    },
    language: {
      group: "언어",
      current: "{language} (현재)",
      report: "번역이 틀리거나 어색한가요? 리그에 알려 주세요",
    },
  },
  profile: {
    language: {
      label: "언어",
      hint: "이메일과 알림이 이 언어로 와요. 앱 화면은 아직 영어예요.",
      saved: "저장했어요. 이제 이메일과 알림이 {language}로 와요.",
      save: "언어 저장",
    },
  },
  formats: {
    teams: { $plural: { other: "{n}개 팀" } },
    players: { $plural: { other: "선수 {n}명" } },
  },
  faq: {
    title: "자주 묻는 질문",
    description:
      "팀이 있어야 하나요? 남녀 혼성인가요? 비용은 얼마고, 뭘 입고, 비가 오면 어떻게 되나요? 브루클린 성인 킥볼에 대한 짧은 답변.",
    home: "홈",
    headingStart: "궁금한 점,",
    headingSwipe: "여기 답이 있어요",
    intro:
      "간단히 말하면: 혼성이고, 혼자 와도 되고, 킥볼을 잘할 필요는 전혀 없어요.",
    sections: "질문 분류",
    readyTitle: "언제든 환영해요",
    readyBody:
      "이메일로 로그인해서 팀을 등록하거나, 팀에 들어가거나, 혼자 신청하세요.",
    signUp: "시즌 신청하기",
    joining: {
      title: "참가하기",
      team: {
        question: "팀이 있어야 참가할 수 있나요?",
        answer:
          "아니요. 프리 에이전트로 신청하면 시즌 시작 전에 리그에서 팀을 배정해 드려요. 혼자 오는 분도 많고, 사람을 사귀는 가장 빠른 방법이에요.",
      },
      friend: {
        question: "친구 팀에는 어떻게 들어가나요?",
        answer:
          "주장에게 팀 초대 링크를 받으세요. 링크를 열고 이메일로 로그인한 뒤 면책 동의서(waiver)에 서명하고, 팀이 참가비를 나눠 낸다면 내 몫을 내면 돼요. 그러면 명단에 올라가요.",
      },
      age: {
        question: "몇 살부터 참가할 수 있나요?",
        answer:
          "만 18세 이상이면 경기에 나갈 수 있어요. 바에서 열리는 일부 모임은 만 21세 이상만 가능하고, 이벤트 페이지에 적혀 있어요.",
      },
      skill: {
        question: "킥볼을 잘해야 하나요?",
        answer:
          "전혀요. 어릴 때 쉬는 시간에 공 차던 기억이 있으면 충분해요. 경기는 친근하고, 심판이 판정을 설명해 주고, 헛발질해도 아무도 신경 안 써요.",
      },
    },
    season: {
      title: "시즌",
      when: {
        question: "경기는 언제 하나요?",
        answer:
          "시즌과 공원 허가에 따라 달라요. 여름에는 일요일 오후, 봄과 가을에는 평일 저녁이에요. 각 시즌 페이지에 신청이 열리기 전에 정확한 요일과 시간이 나와요.",
      },
      where: {
        question: "어디서 경기하나요?",
        answer:
          "브루클린의 McCarren Park에서 해요. Greenpoint와 Williamsburg 경계에 있어요. 경기 페이지에 내 경기장이 나와 있어요.",
        more: "McCarren Park 가는 법",
      },
      cost: {
        question: "비용은 얼마인가요?",
        answer:
          "참가비는 시즌마다 정해지고, 무엇이 포함되는지와 함께 결제 전에 시즌 페이지에 나와요. 선수당 받는 시즌도 있고 팀당 받는 시즌도 있어요. 팀이 참가비를 나눠 내면 선수마다 온라인으로 자기 몫을 내요.",
      },
      length: {
        question: "경기는 얼마나 걸리나요?",
        answer:
          "경기는 모두 한 시간 안에 끝나서, 저녁 먹을 시간도 되고 팀원들과 한잔(또는 탄산수 한 잔) 할 시간도 충분해요.",
      },
      coed: {
        question: "리그가 혼성인가요?",
        answer:
          "네. 모든 팀이 혼성으로 뛰고, 라인업은 리그의 성비 규칙을 따라요. 주장과 심판이 이걸 챙겨요.",
      },
      rain: {
        question: "비가 오면 어떻게 되나요?",
        answer:
          "리그 담당자가 일기예보를 보고 결정해요. 보통 전날이에요. 경기가 우천 취소되면 경기 페이지에 표시되고, 재경기 시간이 정해지면 거기에 올라와요.",
      },
    },
    gameDay: {
      title: "경기 날",
      wear: {
        question: "뭘 입어야 하나요?",
        answer:
          "운동화나 인조잔디화, 팀 색깔 옷, 그리고 저녁 경기엔 겉옷 하나. 여름엔 물과 선크림을 챙기세요.",
      },
      drink: {
        question: "꼭 술을 마셔야 하나요?",
        answer:
          "아니요. 경기 후 어울리는 것도 재미지만, 술이든 탄산수든 자유고 그냥 집에 가는 사람도 많아요. 시 공원에서는 음주가 금지라서 음료는 경기가 끝난 뒤에요.",
      },
      watch: {
        question: "친구들이 구경 와도 되나요?",
        answer:
          "물론이죠. 누구나 오는 공원이고, 사이드라인 응원은 킥에 도움만 돼요.",
      },
    },
  },
  schedule: {
    title: "일정",
    seasonTitle: "{season} 일정",
    divisionTitle: "{division} 일정",
    seasonNav: "시즌",
    standings: "순위표",
    playoffs: "플레이오프",
    statusLabel: "경기일 상황",
    divisionsNav: "디비전",
    allDivisions: "전체 디비전",
    comingSoon: "곧 공개",
    comingSoonBody:
      "일정은 개막 약 일주일 전에 나와요. 지금 신청하면 일정이 올라올 때 이메일로 알려 드릴게요.",
    team: "팀",
    allTeams: "전체 팀",
    show: "보기",
    teamPage: "{team} 팀 페이지와 캘린더",
    showingTeam: {
      $plural: { other: "{name}의 경기 {n}개를 보여 주고 있어요." },
    },
    showingAll: {
      $plural: { other: "전체 경기 {n}개를 보여 주고 있어요." },
    },
    themeWeek: "테마 주간:",
    open: "빈 시간",
    crossover: "교류전",
    makeups: "일정을 잡을 재경기",
    makeupsBody:
      "이 경기들은 새 날짜가 필요해요. 리그가 날짜를 정하는 대로 여기, 팀 페이지, 캘린더에 나와요.",
    kickoff: "시작",
    fieldTba: "경기장 미정",
    timeTba: "시간 미정",
  },
  gameStatus: {
    ruling: "판정",
    cancelled: "취소",
    postponed: "연기",
    rainedOut: "우천 취소",
    final: "종료",
    forfeit: "몰수",
    live: "진행 중",
  },
  gameday: {
    updated: "{time} 업데이트",
    gamesOn: "경기 진행해요.",
    watchingDay: "날씨를 보고 있어요: {time}까지 결정할게요.",
    someLate: "일부 경기가 늦게 시작해요.",
    allLate: "모든 경기가 늦게 시작해요.",
    someOff: "일부 경기가 취소됐어요.",
    allOff: "모든 경기가 취소됐어요.",
    watchingGame: "날씨 확인 중: {time}까지 결정",
    startsLate: "늦게 시작: {time}",
    off: "취소",
  },
  ruleSet: {
    bestOf: "{n}세트 중 다승제",
    daylight: "일몰 {minutes}분 전에 경기 종료",
    innings: { $plural: { other: "{n}이닝" } },
    timeLimit: "{minutes}분 제한",
    bunting: "번트 허용",
    noBunting: "번트 금지",
    stealing: "도루 허용",
    noStealing: "도루 금지",
  },
  home: {
    title: "{site} · 브루클린 성인 혼성 킥볼",
    sticker: "브루클린 McCarren Park ☀️",
    heroStart: "공을 차고, 새로 아끼게 될",
    heroSwipe: "사람들을 만나요.",
    intro:
      "학교 쉬는 시간 이후로 킥볼을 해 본 적 없는 사람들을 위한 브루클린 성인 혼성 킥볼이에요. 팀과 함께 와도 되고, 혼자 오면 팀을 찾아 드려요. 경기 후엔 남아서 한잔(또는 탄산수 한 잔) 해요.",
    signUp: "시즌 신청하기",
    questions: "궁금한 게 있나요? 답이 있어요",
    basics: "기본 정보",
    facts: {
      what: {
        term: "무엇",
        detail: "성인 혼성 킥볼. 친근한 경기, 진짜 순위표.",
      },
      where: {
        term: "어디",
        detail: "McCarren Park, Greenpoint와 Williamsburg 사이.",
        link: "오시는 길",
      },
      when: {
        term: "언제",
        detail: "여름엔 일요일 오후, 봄과 가을엔 평일 저녁.",
        link: "일정과 순위",
      },
      price: {
        term: "가격",
        detail:
          "시즌마다 정해지고 결제 전에 보여요. 팀은 참가비를 나눠 낼 수 있어요.",
        link: "참가비 안내",
      },
    },
    waysIn: "참가하는 세 가지 방법",
    ways: {
      team: {
        title: "팀과 함께 오기",
        body: "주장으로 등록하고 단톡방에 초대 링크 하나만 공유하면, 모두 각자 신청하고 자기 몫을 내요.",
      },
      friend: {
        title: "친구 팀에 들어가기",
        body: "주장의 초대 링크를 열고 면책 동의서에 서명하면 명단에 올라가요.",
      },
      solo: {
        title: "혼자 오기",
        body: "프리 에이전트로 신청하면 팀을 배정해 드려요. 재미의 절반은 새로운 사람들이에요.",
        link: "혼자 신청하는 법",
      },
    },
    afterTitle: "경기는 절반일 뿐",
    afterBody:
      "팀들은 경기 후에 함께 어울리고, 시즌마다 플레이오프로 마무리하고, 대부분 새 친구 몇 명과 함께 돌아가요. 술을 마실 필요도, 킥볼을 잘할 필요도 없어요.",
    aboutLink: "리그 더 알아보기",
    photos: "최근 경기장 풍경",
    opensPost: "(Instagram에서 게시물 열기)",
    newHere: "킥볼이나 브루클린이 처음인가요?",
    newHereLinks: {
      howToPlay: "킥볼 하는 법",
      elsewhere: "뉴욕 다른 지역에서 오는 경우",
      solo: "팀 없이 참가하는 법",
    },
    league: {
      description: "{league}: 시즌, 일정, 순위, 팀, 이벤트.",
      intro:
        "{league}의 시즌, 일정, 순위, 이벤트. 이 사이트의 어느 리그든 같은 계정으로 신청할 수 있어요.",
      seasons: "시즌",
      noSeasons: "첫 시즌 일정이 공개되면 여기에 나와요.",
      schedule: "일정",
      standings: "순위표",
      more: "{league} 더 보기",
      events: "이벤트",
      sponsors: "스폰서",
      history: "리그 역사",
      records: "기록",
    },
  },
  ...pagesKo,
  email: emailKo,
};
