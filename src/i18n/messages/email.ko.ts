import type { Translation } from "../catalog";
import type { emailEn } from "./email.en";

/**
 * The emails and push notifications in Korean (`ko.email`). Friendly
 * polite speech (해요체), and the game words in the glossary in
 * docs/i18n.md.
 */
export const emailKo: Translation<typeof emailEn> = {
  layout: {
    because: "이 이메일은 {reason} 보내 드렸어요.",
    settings: "받을 이메일과 받는 시간 고르기",
    stopAbout: "{topic} 이메일 그만 받기",
    pushBecause: "{reason} 보내 드렸어요.",
  },
  topics: {
    rainout: "우천 취소",
    schedule_change: "일정 변경",
    game_reminder: "리그 장비",
    payment: "결제 알림",
    sub_request: "대체 선수 요청",
    announcement: "공지",
    score: "점수",
    events: "이벤트",
    marketing: "리그 소식과 혜택",
    new_team: "새 팀 신청",
    discipline: "출전 정지",
    digest: "모아 보기",
    operations: "리그 운영",
    photos: "내 사진",
    team_roles: "주장과 부주장",
    game_day_watch: "날씨 확인",
  },
  common: {
    seeGame: "경기 보기",
    seeTeam: "내 팀 보기",
    seeEvent: "이벤트 보기",
    seeOrders: "주문 보기",
    seeCredit: "크레딧 보기",
    seeOtherRequests: "다른 요청 보기",
    openApp: "앱 열기",
    fromLeague: "리그에서: {text}",
    cardRefund: "{returned}. 카드 환불은 보통 5~10일 안에 들어와요.",
    youPaid: "{paid}을(를) 결제했어요.",
    nextFee: "다음 참가비를 낼 때 자동으로 차감돼요.",
  },
  announcement: {
    action: "리그 앱 열기",
    reasonTeam: "{season}에 {team} 팀에서 뛰고 있어서",
    reasonLeague: "{season}에 등록되어 있어서",
  },
  awayShort: {
    subject: "{week} 주에 {team} 인원이 부족할 수 있어요",
    heading: "{week} 주에 인원이 부족한가요?",
    lead: "{player} 님이 그 주에 자리를 비워서, {games}에 나올 수 있는 선수가 {available}명이에요.",
    game: "{when} 상대 {opponent}",
    and: ", ",
    subsOpen:
      "지금 대체 선수를 요청하면 그날 저녁 시간이 되는 선수들에게 알림이 가요.",
    subsClosed:
      "플레이오프 경기는 대체 선수 요청을 받지 않아요. 리그에 문의하세요.",
    askSub: "대체 선수 요청하기",
    reason: "{season}에 {team}의 주장이어서",
  },
  concern: {
    received:
      "{league}에서 메시지를 받았어요. 리그 관리자만 읽고, 그중 한 명이 답변할 거예요.",
    followInApp: "앱에서 진행 상황을 볼 수 있어요.",
    answerByEmail: "주소를 남겼다면 답변은 이 이메일로 와요.",
    replied: "{league}의 답변:",
    closed: "{league}에서 메시지를 종료했어요. 처리 내용:",
    receivedTitle: "메시지를 받았어요",
    replyTitle: "리그의 답변",
    closedTitle: "메시지가 종료됐어요",
    reason: "리그에 메시지를 보내서",
  },
  digest: {
    updates: { $plural: { other: "소식 {n}개" } },
    subject: "리그 소식: {updates}",
    headingDaily: "오늘의 리그 소식",
    headingWeekly: "이번 주 리그 소식",
    lead: {
      $plural: { other: "받은편지함이 조용하도록 모아 둔 소식 {n}개예요." },
    },
    reasonDaily: "급하지 않은 소식을 하루 한 통으로 받기로 해서",
    reasonWeekly: "급하지 않은 소식을 일주일에 한 통으로 받기로 해서",
    reasonCap: {
      $plural: {
        other:
          "급하지 않은 리그 이메일은 하루 최대 {n}통만 받는데, 이건 그 뒤에 온 소식이라서",
      },
    },
    settings: "하루 한도, 모아 보기, 방해 금지 시간 바꾸기",
  },
  event: {
    rsvpOn: "{site}에서 참석 알리기: {url}",
    announcedSubject: "새 이벤트: {title}",
    updatedSubject: "변경: {title}",
    announcedHeading: "초대합니다: {title}",
    updatedHeading: "{title} 내용이 바뀌었어요",
    announcedLead: "{title} 열려요: {where}.",
    updatedLead: "리그가 {title}의 세부 사항을 바꿨어요. 이제 {where}.",
    postedReason: "리그가 회원님을 위한 이벤트를 올려서",
    spotSubject: "자리 확보: {title}",
    spotHeading: "{title}에 자리가 났어요",
    spotLead: "{title}({where}) 대기자 명단에 있었는데, 이제 자리가 생겼어요.",
    spotDrop:
      "계획이 바뀌었나요? 이벤트 페이지에서 자리를 내놓으면 다음 사람에게 돌아가요.",
    waitlistReason: "이 이벤트 대기자 명단에 올라서",
    offSubject: "취소: {title}",
    offHeading: "{title} 취소",
    offLead:
      "리그가 {title}({where})을(를) 취소했어요. 미안해요. 참석 표시는 지워졌고, 따로 할 일은 없어요.",
    otherEvents: "다른 이벤트 보기",
    rsvpReason: "이 이벤트에 참석한다고 알려서",
  },
  ticket: {
    receiptSubject: "내 티켓: {title}",
    receiptHeading: "{title}에 가요!",
    receiptLead: "{title}({where}) 티켓이 확정됐어요.",
    code: "체크인 코드는 {code}예요. 입구에서 보여 주세요.",
    seeTicket: "티켓 보기",
    boughtReason: "티켓을 구매해서",
    refundedSubject: "환불: {title}",
    refundedHeading: "{title} 티켓이 환불됐어요",
    refundedLead:
      "리그가 {title}({where}) 티켓을 환불해서 이제 이 티켓으로는 입장할 수 없어요.",
    offeredSubject: "자리가 났어요: {title}",
    offeredHeading: "{title}에 자리가 났어요",
    offeredLead:
      "{title}({where}) 대기자 명단에 있었는데, 지금 자리를 맡아 두었어요.",
    buyBy: "{expires}까지 티켓을 사세요. 그 뒤엔 다음 사람에게 넘어가요.",
    buy: "티켓을 사세요. 그 뒤엔 다음 사람에게 넘어가요.",
    buyAction: "티켓 사기",
  },
  gameDay: {
    laterTime: "더 늦은 시간",
    delayedSubject: "늦게 시작: {teams}, {day}",
    delayedHeading: "경기가 {time}에 시작해요",
    delayedLead:
      "{day} {teams} 경기는 원래 {was} 시작이었는데, 이제 {time}에 시작해요.{why}",
    offSubject: "취소: {teams}, {day}",
    offHeading: "경기가 취소됐어요",
    offLead:
      "{day} {was} {teams} 경기가 취소됐어요.{why} 리그가 일정을 다시 잡으면 재경기 시간을 알려 드릴게요.",
    backSubject: "다시 진행: {teams}, {day}",
    backHeading: "경기가 다시 진행돼요",
    backLead: "{day} {teams} 경기가 {was}에 다시 진행돼요.{why}",
    playReason: "{season}에 뛰고 있어서",
    watchSubject: "날씨 확인 중: {day} {time}까지 결정",
    watchHeading: "{time}까지 결정할게요",
    watchLead:
      "리그가 {day} {teams} 경기의 날씨를 보고 있고, {time}까지 경기 진행 여부를 정해요.{why}",
    watchMore: "경기가 늦게 시작하거나 취소되면 메시지를 한 번 더 보내 드려요.",
    watchReason: "경기 전 날씨 알림을 받기로 해서",
  },
  gear: {
    holding: "{kit}을(를) 갖고 있어요.",
    onItsWay: "{kit}이(가) 가는 중이에요. 받으면 앱에서 확인해 주세요.",
    with: "지금 {name} 님이 {kit}을(를) 갖고 있어요. 받아 오고, 건네받을 때 앱에서 확인해 주세요.",
    atHome:
      '{kit}은(는) {place}에 있어요. 챙기면 앱에서 "I picked up {kit}"을 누르세요.',
    subject: "{day} {by}까지 {kit}을(를) {place}로 가져와 주세요",
    heading: "{teams} 경기용 {kit}",
    bring:
      "{day} {by}까지 {place}로 가져와 주세요. {teams} 경기 시작 30분 전이에요.",
    missing: "키트에 빠진 게 있으면 앱에서 알려 주세요. 리그가 채워 놓을게요.",
    action: "내 장비 열기",
    reason: "이 경기에 리그 장비를 가져오기로 해서",
  },
  giveaway: {
    subject: "{event} 경품 추첨에 당첨됐어요",
    heading: "당첨!",
    lead: "{event} 경품 추첨에서 이름이 뽑혔어요: {prize}.",
    leadFrom: "{event} 경품 추첨에서 이름이 뽑혔어요: {prize}, {donor} 제공.",
    claim:
      "받는 방법은 추첨 페이지에 있어요. 체크인한 모든 사람 중에서 무작위로 뽑았어요.",
    action: "경품 보기",
    reason: "{event} 경품 추첨에 참여해서",
  },
  merch: {
    teamColors: "{description}, {team} 컬러",
    receiptSubject: "주문: {description}",
    receiptHeading: "주문해 줘서 고마워요",
    receiptLead: "{what} 주문이 접수됐어요.",
    letYouKnow: "준비되면 알려 드릴게요.",
    reason: "리그 숍에서 주문해서",
    readySubject: "준비 완료: {description}",
    readyHeading: "주문이 준비됐어요",
    readyLead: "{what} 준비가 끝났어요. 다음 경기 때 리그에서 받아 가세요.",
    refundedSubject: "환불: {description}",
    refundedHeading: "주문이 환불됐어요",
    refundedLead: "리그가 {what} 주문을 환불했어요.",
  },
  money: {
    warningSubject: "{team} 미납액 {balance}: {on}에 카드로 결제돼요",
    warningHeading: "알림: {team} 미납액 {balance}",
    warningLead:
      "팀의 {season} 참가비 중 {balance}이(가) 아직 미납이에요. 팀 보증인으로서 {on}에 회원님의 {card}로 이 금액이 결제돼요.",
    warningMore:
      "그전에 팀원들이 내는 금액은 결제액에서 빠져요. 나머지는 나중에 팀원들에게 받거나, 다른 방법으로 내고 싶다면 카드를 삭제하세요.",
    whoPaid: "누가 냈는지 보기",
    guaranteeReason: "{team} 참가비 보증용으로 카드를 저장해서",
    failedSubject: "{team} 참가비를 카드로 결제하지 못했어요",
    failedHeading: "카드 결제가 거절됐어요",
    failedLead:
      "{team}의 {season} 남은 참가비 {balance}을(를) 저장된 카드로 결제하려 했지만, 은행에서 거절했어요.",
    failedMore:
      "참가비를 다 내야 팀이 확정돼요. 팀 페이지에서 남은 금액을 내거나 다른 카드를 저장하세요.",
    payBalance: "남은 금액 내기",
    waitlistSubject:
      "{season}에 팀 자리가 났어요. {expires}까지 회원님 자리예요",
    waitlistHeading: "차례가 왔어요! 자리가 났어요",
    waitlistLead:
      "{season}에 팀 자리가 하나 났고, 대기자 명단에서 다음 순서예요. {expires}까지 자리를 잡아 둘게요.",
    waitlistMore:
      "그전에 팀을 등록하면 자리를 가져갈 수 있어요. 그 뒤엔 다음 팀에게 넘어가요.",
    registerTeam: "팀 등록하기",
    waitlistReason: "{season} 대기자 명단에 올라서",
    referralSubject: "리그 크레딧 {amount}을(를) 받았어요",
    referralHeading: "친구를 데려와 줘서 고마워요",
    referralLead:
      "초대한 분이 방금 {season} 결제를 해서, 계정에 리그 크레딧 {amount}이(가) 들어왔어요.",
    referralReason: "누군가 추천 링크로 등록해서",
    rebateSubject: "우천 취소 경기에 대한 리그 크레딧 {amount}",
    rebateHeading: "참가비 일부가 돌아와요",
    rebateLead:
      "{team}은(는) {season}의 {count}경기 중 {lost}경기를 날씨 때문에 치르지 못했고 재경기도 못 했어요. 환급금 중 회원님 몫 {amount}이(가) 리그 크레딧으로 들어왔어요.",
    rebateReason: "{team}의 {season} 참가비를 내서",
  },
  newTeam: {
    approvedSubject: "{team}, {season} 참가 확정",
    approvedHeading: "팀이 승인됐어요",
    approvedLead:
      "리그가 승인했어요. {team}이(가) {season}에 만들어졌고, 회원님이 주장이에요.",
    approvedMore:
      "이제 선수들이 들어올 수 있게 팀 초대 링크를 공유하고, 면책 동의서에 서명하세요. 선수가 충분하고 참가비가 다 모이면 팀이 확정돼요.",
    invite: "선수 초대하기",
    askedReason: "{team} 창단을 신청해서",
    declinedSubject: "{team} 창단 신청 관련",
    declinedHeading: "새 팀 신청 결과",
    declinedLead: "리그가 {team}을(를) {season}에 추가할 수 없어요.",
    declinedMore: "초대를 받거나 프리 에이전트로 다른 팀에 들어갈 수는 있어요.",
    seeSeason: "내 시즌 보기",
    leftSubject: "{player} 님이 새 팀을 만들어요",
    leftHeading: "{player} 님이 {left}을(를) 떠났어요",
    leftLead:
      "리그가 {player} 님의 {season} {team} 창단 신청을 승인해서, 이제 회원님 팀 명단에 없어요.",
    leftMore:
      "선수가 더 필요하면 한 명 초대하거나 리그에 프리 에이전트를 요청하세요.",
    seeRoster: "명단 보기",
    captainReason: "{team}의 주장이어서",
  },
  payment: {
    today: "오늘",
    tomorrow: "내일",
    inDays: { $plural: { other: "{n}일 후" } },
    subject: "{season} 참가비 마감: {when}",
    heading: "{when}까지 자리 비용을 내 주세요",
    lead: "{season} 결제 마감은 {deadline}이에요. 그전에 내야 자리를 지킬 수 있어요.",
    waiverFirst:
      "먼저 시즌 면책 동의서에 서명하세요. 바로 다음이 결제 단계예요.",
    byCard:
      "카드로 1분이면 돼요. 이미 주장에게 현금이나 Venmo로 냈다면, 주장에게 앱에 표시해 달라고 하세요.",
    action: "지금 결제하기",
    reason: "{season}에 등록했지만 아직 결제하지 않아서",
  },
  photo: {
    approvedSubject: "사진이 선정됐어요",
    approvedHeading: "사진이 올라갔어요",
    approvedLead:
      "공유해 줘서 고마워요! 리그가 사진을 승인했고, 지금 {where}에 보여요. 리그 SNS에 올라갈 수도 있어요.",
    deleteAnytime: "내 사진에서 언제든 삭제할 수 있어요.",
    seeIt: "사이트에서 보기",
    rejectedSubject: "올린 사진 관련",
    rejectedHeading: "리그가 사진을 쓰지 않기로 했어요",
    rejectedLead:
      "보내 줘서 고마워요. 이 사진은 게시하지 않기로 해서 사이트에서 삭제했어요.",
    keepThem:
      "계속 보내 주세요. 선명하고 밝은 경기일과 이벤트 사진이 뽑힐 확률이 높아요.",
    yourPhotos: "내 사진",
    reason: "리그에 사진을 올려서",
  },
  privateEvent: {
    tournament: "토너먼트",
    league: "비공개 리그",
    reason: "{organization}을(를) 위한 {what}을(를) 리그에 요청해서",
    receivedSubject: "{what} 요청을 받았어요",
    receivedHeading: "고마워요, 요청을 받았어요",
    receivedLead:
      "리그가 {organization}을(를) 위한 {what} 요청을 받았어요. 관리자가 경기장과 날짜를 확인하고 보통 일주일 안에 연락드려요.",
    receivedMore: "진행 상황은 언제든 볼 수 있어요.",
    seeRequest: "요청 보기",
    acceptedSubject: "{season} 확정",
    acceptedHeading: "{what} 준비가 끝났어요",
    acceptedLead:
      "리그가 {organization}을(를) 위해 {season}을(를) 만들었어요. 비공개라서 회원님 팀들만 들어올 수 있고, 리그 공개 페이지에는 아무것도 나오지 않아요.",
    acceptedMore:
      "각 팀 주장에게 초대 링크를 공유하세요. 내 페이지에서 들어오는 팀, 공개된 일정, 결과를 볼 수 있어요.",
    organizerPage: "주최자 페이지 열기",
    declinedSubject: "{what} 요청 관련",
    declinedHeading: "요청 결과",
    declinedLead:
      "이번에는 리그가 {organization}을(를) 위한 {what}을(를) 열 수 없어요.",
    declinedMore: "다른 날짜로 다시 요청해 주셔도 좋아요.",
    askAgain: "다시 요청하기",
  },
  rainout: {
    movesSubject: "우천 취소: {teams} 경기가 {makeup}(으)로 옮겨져요",
    postponedSubject: "우천 취소: {teams} 경기 연기",
    newTimeHeading: "경기 시간이 새로 잡혔어요",
    postponedHeading: "경기가 연기됐어요",
    lead: "{teams}({was}) 경기가 우천 취소됐어요.",
    makeup: "재경기는 {makeup}이에요. 못 오면 주장에게 알려 주세요.",
    noMakeup: "아직 재경기 시간이 없어요. 리그가 정하는 대로 일정에 올라가요.",
    action: "일정 보기",
    reason: "{season}에 이 경기에 뛰어서",
  },
  referee: {
    subject: "심판 구해요: {teams}, {when}",
    heading: "이 경기 심판 봐 줄 수 있나요?",
    dropped: "{teams}, {when} 경기의 심판이 빠졌어요.",
    none: "{teams}, {when} 경기에 아직 심판이 없어요.",
    first:
      '"Take it"을 가장 먼저 누른 심판이 경기를 맡아요. 누가 먼저 눌렀다면 페이지에 나와요.',
    action: "맡을게요",
    reason: "{season}에 심판을 보고 있고, 그 시간에 경기나 심판 일정이 없어서",
  },
  ruleChange: {
    subject: "{on}부터 규칙 변경: {summary}",
    heading: "리그 규칙이 바뀌어요",
    effective: "{on}부터 적용돼요.",
    sections: {
      $plural: { other: "바뀐 항목: {sections}." },
    },
    read: "규칙 페이지에서 새 문구를 읽어 보고, 헷갈리는 게 있으면 주장이나 리그에 물어보세요.",
    action: "규칙 읽기",
    reason: "리그 시즌에 뛰고 있어서",
  },
  scoreConfirm: {
    subject: "점수 확인: {result}",
    heading: "이 점수가 맞나요?",
    lead: "{reportedBy} 님이 {teams}({when}) 경기 점수를 {result}(으)로 보고했어요.",
    more: "맞으면 확인하고, 틀리면 이의를 제기하세요. 아무도 이의를 제기하지 않으면 24시간 후에 확정돼요.",
    action: "확인 또는 이의 제기",
    reason: "이 경기 한 팀의 주장이어서",
  },
  scoreReminder: {
    subject: "점수가 필요해요: {teams}",
    heading: "최종 점수가 어떻게 됐나요?",
    lead: "{teams}({when}) 경기에 아직 점수가 없어요.",
    referee:
      "심판으로서 지금 입력해 주면 오늘 밤 순위표가 업데이트돼요. 몇 초면 돼요.",
    captain:
      "심판이 아직 입력하지 않았어요. 어느 팀 주장이든 입력할 수 있고, 상대 팀이 확인해요.",
    action: "점수 입력하기",
    refereeReason: "이 경기의 심판이어서",
    captainReason: "이 경기 한 팀의 주장이어서",
  },
  seasonCard: {
    subject: "나의 {season} 킥볼 시즌",
    heading: "나의 킥볼 시즌",
    lead: "{season}이(가) 끝났어요. 카드에 내 경기, 팀 득점과 전적, 수상, 베스트 경기가 담겨 있어요.",
    private: "링크를 공유하기 전까지는 나만 볼 수 있어요.",
    action: "내 시즌 보기",
    reason: "{season}에 뛰어서",
  },
  shirt: {
    subject: "{season} 셔츠 사이즈",
    heading: "셔츠 사이즈가 어떻게 되나요?",
    lead: "리그가 {season} 셔츠를 주문하는데, 아직 회원님 사이즈를 몰라요.",
    pick: "프로필에서 골라 주세요: {sizes}. 몇 초면 돼요.",
    action: "사이즈 고르기",
    reason: "{season}에 등록되어 있어서",
  },
  sub: {
    requestSubject: "{team}에 {spots} 필요: {when}",
    requestHeading: "{team}에 대체 선수가 필요해요",
    requestLead: "{teams}, {when}. {team}에서 {spots}을(를) 찾고 있어요.",
    fromCaptain: "주장 메시지: {note}",
    hold: '"I\'m in"을 눌러 자리를 맡으세요. 주장이 확인하면 이메일로 답이 와요.',
    seeRequests: "대체 선수 요청 보기",
    freeAgentReason: "{season} 프리 에이전트이고 그 시간에 시간이 돼서",
    playerReason: "{season}에 뛰고 있고 그 시간에 팀 경기가 없어서",
    claimedSubject: "{player} 님이 대체 선수로 뛰고 싶어 해요: {when}",
    claimedHeading: "{player} 님이 대체 선수로 뛸 수 있어요",
    claimedLead: "{player} 님이 {teams}, {when} 경기에 자리를 맡았어요.",
    claimedMore: "승인해서 뛴다는 걸 알려 주거나, 거절해서 자리를 비워 주세요.",
    approveOrDecline: "승인 또는 거절",
    captainReason: "대체 선수를 요청한 {team}의 주장이어서",
    withdrawnSubject: "{player} 님이 결국 못 뛰어요: {when}",
    withdrawnHeading: "대체 선수가 빠졌어요",
    withdrawnLead:
      "{player} 님이 {teams}, {when} 경기에 더 이상 못 뛰어요. 자리가 다시 비었어요.",
    seeYourRequest: "내 요청 보기",
    approvedSubject: "{team} 대체 선수로 뛰어요: {when}",
    approvedHeading: "경기에 나가요!",
    approvedLead: "{team} 주장이 승인했어요. {teams}, {when} 경기에 뛰어요.",
    approvedMore:
      "가능하면 팀 색깔 옷을 입어 주세요. 계획이 바뀌면 대체 선수 페이지에서 빠져서 다른 사람을 찾을 수 있게 해 주세요.",
    seeDetails: "자세히 보기",
    offeredReason: "{team} 대체 선수로 뛰겠다고 해서",
    declinedSubject: "{team} 인원 충분: {when}",
    declinedHeading: "나서 줘서 고마워요",
    declinedLead:
      "{team} 주장이 {teams}, {when} 경기 인원을 다 채웠어요. 나서 줘서 고마워요.",
    cancelledSubject: "{team}에 더 이상 대체 선수가 필요 없어요: {when}",
    cancelledHeading: "요청이 내려갔어요",
    cancelledLead:
      "{team}이(가) {teams}, {when} 경기의 대체 선수 요청을 내려서, 이 경기엔 안 뛰어요. 나서 줘서 고마워요.",
  },
  survey: {
    subject: "{season} 어땠나요?",
    lead: "시즌에 대한 짧은 질문 다섯 개, 2분쯤 걸려요. 답변은 익명이에요. 리그는 합계와 의견만 보고, 누가 썼는지는 절대 못 봐요.",
    action: "설문 참여하기",
    reason: "{season}에 뛰어서",
  },
  suspension: {
    subject: "출전 정지: {length}",
    heading: "출전 정지됐어요",
    banned: "사건 보고 후 {league}에서 회원님을 영구 출전 금지했어요.",
    suspended:
      "사건 보고 후 {league}에서 {season}에 {length} 출전 정지를 내렸어요.",
    lastsGames:
      "팀 경기가 확정될 때마다 줄어들고, 해당 경기를 다 치르면 자동으로 끝나요.",
    lastsSeason: "시즌이 끝나면 끝나요.",
    lastsPermanent: "리그가 해제할 때까지 이어져요.",
    meaning:
      "출전 정지 기간에는 경기 참석을 알리거나, 대체 선수 자리를 맡거나, 프리 에이전트로 팀에 배정될 수 없어요. 주장은 출전 정지 사실만 보고, 이유는 보지 못해요.",
    appealTo:
      "이의를 제기하려면 이 이메일에 답장하거나 {email}로 연락해서, 리그가 알았으면 하는 내용을 알려 주세요.",
    appeal:
      "이의를 제기하려면 이 이메일에 답장해서, 리그가 알았으면 하는 내용을 알려 주세요.",
    reason: "사건 보고 후 리그가 출전 정지를 내려서",
  },
  teamRole: {
    offeredSubject: "{captain} 님이 {team} 주장을 맡아 달라고 해요",
    offeredHeading: "{team} 주장을 맡을래요?",
    offeredLead: "{captain} 님이 {season} {team}의 주장을 넘겨주고 싶어 해요.",
    offeredMore:
      "수락하기 전까지는 아무것도 바뀌지 않아요. 주장은 명단, 초대, 결제, 부주장을 관리하고, 지금 주장은 부주장으로 남아요.",
    answer: "팀 페이지에서 답하기",
    playReason: "{team}에서 뛰고 있어서",
    acceptedSubject: "{player} 님이 이제 {team}의 주장이에요",
    acceptedHeading: "팀에 새 주장이 생겼어요",
    acceptedLead:
      "{player} 님이 수락했어요. 이제부터 {season} {team}의 주장이에요.",
    acceptedMore:
      "회원님은 부주장으로 남아 라인업, 대체 선수 요청, 점수를 맡아요. 새 주장이 바꿀 수 있어요.",
    offeredReason: "{player} 님에게 주장을 제안해서",
    declinedSubject: "{player} 님이 {team} 주장을 맡지 않기로 했어요",
    declinedHeading: "계속 주장이에요",
    declinedLead:
      "{player} 님이 {team} 주장 제안을 거절해서, {season}에도 회원님이 주장이에요.",
    declinedMore: "팀 페이지에서 다른 팀원에게 제안할 수 있어요.",
    coSubject: "{team}의 부주장이 됐어요",
    coHeading: "부주장이 됐어요",
    coLead:
      "이제 {season} {team} 운영을 도와요: 킥 순서 정하기, 대체 선수 요청, 점수 입력과 확인, 결제 현황 보기.",
    coMore: "언제든 팀 페이지에서 물러날 수 있어요.",
    playerSubject: "더 이상 {team}의 부주장이 아니에요",
    playerHeading: "다시 선수로",
    playerLead: "이제 {season} {team}에서 부주장 도구 없이 선수로 뛰어요.",
  },
  volunteer: {
    subject: "내일: {role} 봉사",
    heading: "봉사해 줘서 고마워요!",
    lead: "{occasion}에서 {role}을(를) 맡았어요: {when}.",
    leadAt: "{occasion}에서 {role}을(를) 맡았어요: {when}, {place}.",
    drop: "못 가게 됐나요? 앱에서 봉사를 취소해서 다른 사람이 맡을 수 있게 해 주세요.",
    action: "내 봉사 보기",
    reason: "봉사 시간에 신청해서",
  },
  winBack: {
    reason: "전에 리그에서 뛰었고 {season} 등록이 열려서",
  },
};
