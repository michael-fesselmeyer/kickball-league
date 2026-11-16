import type { Translation } from "../catalog";
import type { emailEn } from "./email.en";

/**
 * The emails and push notifications in Polish (`pl.email`). Casual "ty",
 * and the game words in the glossary in docs/i18n.md. Counts inside a plain
 * message come after a colon or dash, so no ending has to agree with them.
 */
export const emailPl: Translation<typeof emailEn> = {
  layout: {
    because: "Dostajesz ten e-mail, ponieważ {reason}.",
    settings: "Wybierz, jakie e-maile dostajesz i kiedy",
    stopAbout: "Nie wysyłaj e-maili o: {topic}",
    pushBecause: "Ponieważ {reason}.",
  },
  topics: {
    rainout: "odwołania przez deszcz",
    schedule_change: "zmiany w terminarzu",
    game_reminder: "sprzęt ligi",
    payment: "przypomnienia o płatności",
    sub_request: "prośby o zmiennika",
    announcement: "ogłoszenia",
    score: "wyniki",
    events: "wydarzenia",
    marketing: "nowości i oferty ligi",
    new_team: "zgłoszenia nowych drużyn",
    discipline: "zawieszenia",
    digest: "podsumowanie",
    operations: "działanie ligi",
    photos: "twoje zdjęcia",
    team_roles: "kapitan i wicekapitanowie",
    game_day_watch: "obserwacja pogody",
  },
  common: {
    seeGame: "Zobacz mecz",
    seeTeam: "Zobacz swoją drużynę",
    seeEvent: "Zobacz wydarzenie",
    seeOrders: "Zobacz swoje zamówienia",
    seeCredit: "Zobacz swój kredyt",
    seeOtherRequests: "Zobacz inne prośby",
    openApp: "Otwórz aplikację",
    fromLeague: "Od ligi: {text}",
    cardRefund:
      "{returned}. Zwrot na kartę zwykle pojawia się w ciągu 5–10 dni.",
    youPaid: "Zapłacono {paid}.",
    nextFee: "Zostanie automatycznie odjęty od twojej następnej opłaty.",
  },
  announcement: {
    action: "Otwórz aplikację ligi",
    reasonTeam: "grasz w drużynie {team} w sezonie {season}",
    reasonLeague: "jesteś zapisany(-a) na sezon {season}",
  },
  awayShort: {
    subject: "{team} może mieć za mało osób w tygodniu {week}",
    heading: "Za mało osób w tygodniu {week}?",
    lead: "{player} nie będzie w tym tygodniu, więc na {games} dostępnych zawodników: {available}.",
    game: "{when} z {opponent}",
    and: " i ",
    subsOpen:
      "Poproś teraz o zmiennika, a zawodnicy wolni tego wieczoru się o tym dowiedzą.",
    subsClosed:
      "Prośby o zmiennika nie są dostępne w meczach play-off; zapytaj ligę.",
    askSub: "Poproś o zmiennika",
    reason: "jesteś kapitanem drużyny {team} w sezonie {season}",
  },
  concern: {
    received:
      "{league} otrzymała twoją wiadomość. Czytają ją tylko administratorzy ligi i jeden z nich odpowie.",
    followInApp: "Możesz śledzić ją w aplikacji.",
    answerByEmail:
      "Jeśli podałeś(-aś) adres, odpowiedź przyjdzie na ten e-mail.",
    replied: "{league} odpowiada:",
    closed: "{league} zamknęła twoją wiadomość. Co zostało zrobione:",
    receivedTitle: "Mamy twoją wiadomość",
    replyTitle: "Odpowiedź od ligi",
    closedTitle: "Twoja wiadomość jest zamknięta",
    reason: "wysłałeś(-aś) wiadomość do ligi",
  },
  digest: {
    updates: {
      $plural: {
        one: "{n} nowość",
        few: "{n} nowości",
        many: "{n} nowości",
        other: "{n} nowości",
      },
    },
    subject: "Wieści z ligi: {updates}",
    headingDaily: "Twoje wieści z ligi na dziś",
    headingWeekly: "Twoje wieści z ligi na ten tydzień",
    lead: {
      $plural: {
        one: "Oto {n} wiadomość, którą wstrzymaliśmy, żeby w skrzynce był spokój.",
        few: "Oto {n} wiadomości, które wstrzymaliśmy, żeby w skrzynce był spokój.",
        many: "Oto {n} wiadomości, które wstrzymaliśmy, żeby w skrzynce był spokój.",
        other:
          "Oto {n} wiadomości, które wstrzymaliśmy, żeby w skrzynce był spokój.",
      },
    },
    reasonDaily:
      "wybrałeś(-aś) wiadomości, które mogą poczekać, w jednym e-mailu dziennie",
    reasonWeekly:
      "wybrałeś(-aś) wiadomości, które mogą poczekać, w jednym e-mailu tygodniowo",
    reasonCap: {
      $plural: {
        one: "dostajesz najwyżej {n} e-mail z ligi dziennie, który może poczekać, a te przyszły później",
        few: "dostajesz najwyżej {n} e-maile z ligi dziennie, które mogą poczekać, a te przyszły później",
        many: "dostajesz najwyżej {n} e-maili z ligi dziennie, które mogą poczekać, a te przyszły później",
        other:
          "dostajesz najwyżej {n} e-maila z ligi dziennie, które mogą poczekać, a te przyszły później",
      },
    },
    settings: "Zmień dzienny limit, podsumowanie lub godziny ciszy",
  },
  event: {
    rsvpOn: "Potwierdź na {site}: {url}",
    announcedSubject: "Nowe wydarzenie: {title}",
    updatedSubject: "Zmiana: {title}",
    announcedHeading: "Zapraszamy: {title}",
    updatedHeading: "{title}: są zmiany",
    announcedLead: "{title} się odbędzie: {where}.",
    updatedLead: "Liga zmieniła szczegóły wydarzenia {title}. Teraz: {where}.",
    postedReason: "liga opublikowała wydarzenie dla ciebie",
    spotSubject: "Masz miejsce: {title}",
    spotHeading: "Zwolniło się miejsce: {title}",
    spotLead:
      "Byłeś(-aś) na liście rezerwowej na {title} ({where}), a teraz masz miejsce.",
    spotDrop:
      "Zmiana planów? Zwolnij miejsce na stronie wydarzenia, żeby dostała je następna osoba z listy.",
    waitlistReason: "zapisałeś(-aś) się na listę rezerwową tego wydarzenia",
    offSubject: "Odwołane: {title}",
    offHeading: "{title} jest odwołane",
    offLead:
      "Liga odwołała {title} ({where}). Przepraszamy. Twoje potwierdzenie zostało usunięte i nie musisz nic robić.",
    otherEvents: "Zobacz inne wydarzenia",
    rsvpReason: "potwierdziłeś(-aś) udział w tym wydarzeniu",
  },
  ticket: {
    receiptSubject: "Twój bilet: {title}",
    receiptHeading: "Idziesz na {title}",
    receiptLead: "Twój bilet na {title} ({where}) jest potwierdzony.",
    code: "Twój kod wejścia to {code}. Pokaż go przy wejściu.",
    seeTicket: "Zobacz bilet",
    boughtReason: "kupiłeś(-aś) bilet",
    refundedSubject: "Zwrot: {title}",
    refundedHeading: "Bilet na {title} został zwrócony",
    refundedLead:
      "Liga zwróciła pieniądze za twój bilet na {title} ({where}), więc nie uprawnia już do wejścia.",
    offeredSubject: "Zwolniło się miejsce: {title}",
    offeredHeading: "Zwolniło się miejsce: {title}",
    offeredLead:
      "Byłeś(-aś) na liście rezerwowej na {title} ({where}), a teraz trzymamy dla ciebie miejsce.",
    buyBy:
      "Kup bilet do {expires}. Potem przejdzie na następną osobę w kolejce.",
    buy: "Kup bilet. Potem przejdzie na następną osobę w kolejce.",
    buyAction: "Kup bilet",
  },
  gameDay: {
    laterTime: "później",
    delayedSubject: "Później: {teams}, {day}",
    delayedHeading: "Twój mecz zaczyna się teraz o {time}",
    delayedLead:
      "{teams}, {day}: mecz miał się zacząć o {was}, a teraz zaczyna się o {time}.{why}",
    offSubject: "Odwołany: {teams}, {day}",
    offHeading: "Twój mecz jest odwołany",
    offLead:
      "{teams}, {day}, {was}: mecz odwołany.{why} Dowiesz się o terminie meczu zaległego, gdy liga go ustali.",
    backSubject: "Jednak gramy: {teams}, {day}",
    backHeading: "Twój mecz jednak się odbędzie",
    backLead: "{teams}, {day}: mecz się odbędzie, o {was}.{why}",
    playReason: "grasz w sezonie {season}",
    watchSubject: "Śledzimy pogodę: decyzja do {time}, {day}",
    watchHeading: "Zdecydujemy do {time}",
    watchLead:
      "Liga śledzi pogodę dla meczu {teams} ({day}) i do {time} zdecyduje, czy mecze się odbędą.{why}",
    watchMore:
      "Jeśli twój mecz zacznie się później albo zostanie odwołany, dostaniesz kolejną wiadomość.",
    watchReason: "chcesz dostawać informacje o pogodzie przed meczami",
  },
  gear: {
    holding: "Masz: {kit}.",
    onItsWay:
      "{kit} jest w drodze do ciebie: potwierdź w aplikacji, gdy dostaniesz.",
    with: "{kit} ma teraz {name}; odbierz od tej osoby i potwierdź w aplikacji przy przekazaniu.",
    atHome:
      "{kit} jest tutaj: {place}. Stuknij „I picked up {kit}” w aplikacji, gdy odbierzesz.",
    subject: "Przynieś {kit}: {place}, do {by}, {day}",
    heading: "{kit} na mecz {teams}",
    bring:
      "Przynieś to tutaj: {place}, do {by}, {day} — pół godziny przed meczem {teams}.",
    missing:
      "Jeśli czegoś brakuje w zestawie, zgłoś to w aplikacji, żeby liga uzupełniła.",
    action: "Otwórz swój sprzęt",
    reason: "przynosisz sprzęt ligi na ten mecz",
  },
  giveaway: {
    subject: "Wygrywasz w losowaniu na {event}",
    heading: "Wygrana!",
    lead: "W losowaniu na {event} padło twoje imię: {prize}.",
    leadFrom: "W losowaniu na {event} padło twoje imię: {prize}, od {donor}.",
    claim:
      "Strona losowania mówi, jak odebrać nagrodę. Losowanie było przypadkowe, spośród wszystkich, którzy zrobili check-in.",
    action: "Zobacz nagrodę",
    reason: "wziąłeś(-ęłaś) udział w losowaniu na {event}",
  },
  merch: {
    teamColors: "{description}, w barwach drużyny {team}",
    receiptSubject: "Twoje zamówienie: {description}",
    receiptHeading: "Dzięki za zamówienie",
    receiptLead: "Twoje zamówienie przyjęte: {what}.",
    letYouKnow: "Damy znać, gdy będzie gotowe.",
    reason: "zamówiłeś(-aś) coś w sklepie ligi",
    readySubject: "Gotowe: {description}",
    readyHeading: "Twoje zamówienie jest gotowe",
    readyLead: "Gotowe: {what}. Odbierz od ligi na swoim następnym meczu.",
    refundedSubject: "Zwrot: {description}",
    refundedHeading: "Pieniądze za zamówienie zwrócone",
    refundedLead: "Liga zwróciła pieniądze za twoje zamówienie: {what}.",
  },
  money: {
    warningSubject:
      "{team} wciąż ma do zapłaty {balance}: obciążenie karty {on}",
    warningHeading: "Uwaga: {team} ma jeszcze {balance} do zapłaty",
    warningLead:
      "Z opłaty drużyny za sezon {season} nie zapłacono jeszcze {balance}. Jako gwarant drużyny twoja karta {card} zostanie obciążona tą kwotą {on}.",
    warningMore:
      "Wszystko, co twoi koledzy z drużyny zapłacą wcześniej, zmniejszy obciążenie. Resztę odbierz od nich później albo usuń kartę, jeśli wolisz zapłacić inaczej.",
    whoPaid: "Zobacz, kto zapłacił",
    guaranteeReason:
      "zapisałeś(-aś) kartę jako gwarancję opłaty drużyny {team}",
    failedSubject: "Nie udało się obciążyć twojej karty za {team}",
    failedHeading: "Karta została odrzucona",
    failedLead:
      "Próbowaliśmy obciążyć twoją zapisaną kartę kwotą {balance} za resztę opłaty drużyny {team} za sezon {season}, ale bank odmówił.",
    failedMore:
      "Drużyna nie jest potwierdzona, dopóki opłata nie zostanie zapłacona. Zapłać resztę na stronie drużyny albo zapisz inną kartę.",
    payBalance: "Zapłać resztę",
    waitlistSubject:
      "Zwolniło się miejsce dla drużyny w sezonie {season}. Jest twoje do {expires}",
    waitlistHeading: "Twoja kolej! Właśnie zwolniło się miejsce",
    waitlistLead:
      "W sezonie {season} zwolniło się miejsce dla drużyny, a ty jesteś następny(-a) na liście rezerwowej. Trzymamy je dla ciebie do {expires}.",
    waitlistMore:
      "Zgłoś drużynę przed tym terminem, żeby je zająć. Potem przejdzie na następną drużynę w kolejce.",
    registerTeam: "Zgłoś drużynę",
    waitlistReason: "zapisałeś(-aś) się na listę rezerwową sezonu {season}",
    referralSubject: "Masz {amount} kredytu ligowego",
    referralHeading: "Dzięki, że przyprowadziłeś(-aś) znajomego",
    referralLead:
      "Osoba, którą zaprosiłeś(-aś), właśnie zapłaciła za sezon {season}, więc na twoim koncie jest {amount} kredytu ligowego.",
    referralReason: "ktoś zapisał się przez twój link polecający",
    rebateSubject: "{amount} kredytu ligowego za mecze odwołane przez deszcz",
    rebateHeading: "Część opłaty do ciebie wraca",
    rebateLead:
      "{team}: z {count} meczów sezonu {season} pogoda odwołała bez możliwości odrobienia: {lost}. Twoja część zwrotu, {amount}, jest teraz kredytem ligowym.",
    rebateReason: "płaciłeś(-aś) za opłatę drużyny {team} w sezonie {season}",
  },
  newTeam: {
    approvedSubject: "{team} gra w sezonie {season}",
    approvedHeading: "Twoja drużyna została zatwierdzona",
    approvedLead:
      "Liga się zgodziła: drużyna {team} jest gotowa na sezon {season}, a ty jesteś kapitanem.",
    approvedMore:
      "Teraz udostępnij link z zaproszeniem, żeby zawodnicy mogli dołączyć, i podpisz oświadczenie. Drużyna jest potwierdzona, gdy ma dość zawodników, a opłata jest pokryta.",
    invite: "Zaproś zawodników",
    askedReason: "poprosiłeś(-aś) o założenie drużyny {team}",
    declinedSubject: "W sprawie zgłoszenia drużyny {team}",
    declinedHeading: "Twoje zgłoszenie nowej drużyny",
    declinedLead: "Liga nie może dodać drużyny {team} do sezonu {season}.",
    declinedMore:
      "Nadal możesz dołączyć do drużyny przez zaproszenie albo jako wolny zawodnik.",
    seeSeason: "Zobacz swój sezon",
    leftSubject: "{player} zakłada nową drużynę",
    leftHeading: "{player} opuszcza {left}",
    leftLead:
      "Liga zatwierdziła prośbę {player} o założenie drużyny {team} w sezonie {season}, więc ta osoba nie jest już w twoim składzie.",
    leftMore:
      "Jeśli potrzebujesz kolejnego zawodnika, zaproś kogoś albo poproś ligę o wolnego zawodnika.",
    seeRoster: "Zobacz skład",
    captainReason: "jesteś kapitanem drużyny {team}",
  },
  payment: {
    today: "dziś",
    tomorrow: "jutro",
    inDays: {
      $plural: {
        one: "za {n} dzień",
        few: "za {n} dni",
        many: "za {n} dni",
        other: "za {n} dnia",
      },
    },
    subject: "Opłata za sezon {season}: termin {when}",
    heading: "Zapłać za swoje miejsce {when}",
    lead: "Termin płatności za sezon {season} to {deadline}. Zapłać wcześniej, żeby zachować miejsce.",
    waiverFirst:
      "Najpierw podpisz oświadczenie na sezon; płatność jest zaraz potem.",
    byCard:
      "Kartą to minuta. Jeśli już zapłaciłeś(-aś) kapitanowi gotówką albo przez Venmo, poproś, żeby zaznaczył to w aplikacji.",
    action: "Zapłać teraz",
    reason:
      "zapisałeś(-aś) się na sezon {season} i jeszcze nie zapłaciłeś(-aś)",
  },
  photo: {
    approvedSubject: "Twoje zdjęcie przeszło selekcję",
    approvedHeading: "Twoje zdjęcie jest online",
    approvedLead:
      "Dzięki za udostępnienie! Liga zatwierdziła twoje zdjęcie i jest teraz tutaj: {where}. Może też trafić do mediów społecznościowych ligi.",
    deleteAnytime: "Możesz je w każdej chwili usunąć ze swoich zdjęć.",
    seeIt: "Zobacz na stronie",
    rejectedSubject: "W sprawie przesłanego zdjęcia",
    rejectedHeading: "Liga nie użyła twojego zdjęcia",
    rejectedLead:
      "Dzięki za przesłanie. Liga nie opublikuje tego zdjęcia, więc zostało usunięte ze strony.",
    keepThem:
      "Przysyłaj dalej: wyraźne, dobrze oświetlone zdjęcia z meczów i wydarzeń mają największe szanse.",
    yourPhotos: "Twoje zdjęcia",
    reason: "przesłałeś(-aś) zdjęcie dla ligi",
  },
  privateEvent: {
    tournament: "turniej",
    league: "prywatna liga",
    reason: "poprosiłeś(-aś) ligę o: {what} dla {organization}",
    receivedSubject: "Mamy twoje zgłoszenie: {what}",
    receivedHeading: "Dzięki, mamy twoje zgłoszenie",
    receivedLead:
      "Liga ma twoje zgłoszenie ({what}) dla {organization}. Administrator sprawdzi boiska i terminy i odezwie się, zwykle w ciągu tygodnia.",
    receivedMore: "Możesz w każdej chwili sprawdzić, na jakim jest etapie.",
    seeRequest: "Zobacz zgłoszenie",
    acceptedSubject: "{season} się odbędzie",
    acceptedHeading: "Gotowe: {what}",
    acceptedLead:
      "Liga przygotowała {season} dla {organization}. Jest prywatne: dołączyć mogą tylko twoje drużyny i nic na ten temat nie pojawia się na publicznych stronach ligi.",
    acceptedMore:
      "Udostępnij link z zaproszeniem kapitanowi każdej drużyny. Twoja strona pokazuje drużyny, które dołączają, terminarz, gdy się pojawi, i wyniki.",
    organizerPage: "Otwórz stronę organizatora",
    declinedSubject: "W sprawie zgłoszenia: {what}",
    declinedHeading: "Twoje zgłoszenie",
    declinedLead:
      "Tym razem liga nie może zorganizować: {what} dla {organization}.",
    declinedMore: "Możesz zgłosić się ponownie na inne terminy.",
    askAgain: "Zgłoś ponownie",
  },
  rainout: {
    movesSubject: "Odwołany przez deszcz: {teams} przeniesiony na {makeup}",
    postponedSubject: "Odwołany przez deszcz: {teams} przełożony",
    newTimeHeading: "Twój mecz ma nowy termin",
    postponedHeading: "Twój mecz jest przełożony",
    lead: "{teams} ({was}) odwołany przez deszcz.",
    makeup: "Mecz zaległy: {makeup}. Daj znać kapitanowi, jeśli nie możesz.",
    noMakeup:
      "Nie ma jeszcze terminu meczu zaległego. Nowy termin pojawi się w terminarzu, gdy tylko liga go ustali.",
    action: "Zobacz terminarz",
    reason: "grasz w tym meczu w sezonie {season}",
  },
  referee: {
    subject: "Potrzebny sędzia: {teams}, {when}",
    heading: "Posędziujesz ten mecz?",
    dropped: "Mecz {teams}, {when}, stracił sędziego.",
    none: "Mecz {teams}, {when}, nie ma jeszcze sędziego.",
    first:
      "Mecz dostaje pierwszy sędzia, który stuknie „Take it”. Jeśli ktoś był szybszy, strona to pokaże.",
    action: "Biorę",
    reason:
      "sędziujesz w sezonie {season} i o tej porze nie grasz ani nie sędziujesz",
  },
  ruleChange: {
    subject: "Zmiana zasad od {on}: {summary}",
    heading: "Zasady ligi się zmieniają",
    effective: "Obowiązuje od {on}.",
    sections: {
      $plural: {
        one: "Zmieniony dział: {sections}.",
        few: "Zmienione działy: {sections}.",
        many: "Zmienione działy: {sections}.",
        other: "Zmienione działy: {sections}.",
      },
    },
    read: "Przeczytaj nowe brzmienie na stronie zasad i zapytaj kapitana albo ligę, jeśli coś jest niejasne.",
    action: "Przeczytaj zasady",
    reason: "grasz w sezonie ligi",
  },
  scoreConfirm: {
    subject: "Potwierdź wynik: {result}",
    heading: "Czy ten wynik jest prawidłowy?",
    lead: "{reportedBy} zgłasza wynik {result} meczu {teams} ({when}).",
    more: "Potwierdź go albo zakwestionuj, jeśli jest błędny. Jeśli nikt go nie zakwestionuje, po 24 godzinach stanie się ostateczny.",
    action: "Potwierdź lub zakwestionuj",
    reason: "jesteś kapitanem jednej z drużyn w tym meczu",
  },
  scoreReminder: {
    subject: "Potrzebny wynik: {teams}",
    heading: "Jaki był wynik końcowy?",
    lead: "Mecz {teams} ({when}) nie ma jeszcze wyniku.",
    referee:
      "Jako sędzia wpisz go teraz, żeby tabela zaktualizowała się dziś wieczorem. To kilka sekund.",
    captain:
      "Sędzia go nie wpisał. Może to zrobić każdy z kapitanów, a druga drużyna potwierdza.",
    action: "Wpisz wynik",
    refereeReason: "sędziowałeś(-aś) ten mecz",
    captainReason: "jesteś kapitanem jednej z drużyn w tym meczu",
  },
  seasonCard: {
    subject: "Twój sezon kickballa: {season}",
    heading: "Twój sezon kickballa",
    lead: "{season} przechodzi do historii. Twoja karta ma twoje mecze, punkty i bilans drużyny, twoje nagrody i najlepszy mecz.",
    private: "Widzisz ją tylko ty, dopóki nie udostępnisz linku.",
    action: "Zobacz swój sezon",
    reason: "grałeś(-aś) w sezonie {season}",
  },
  shirt: {
    subject: "Twój rozmiar koszulki na sezon {season}",
    heading: "Jaki rozmiar koszulki nosisz?",
    lead: "Liga zamawia koszulki na sezon {season}, a nie mamy jeszcze twojego rozmiaru.",
    pick: "Wybierz go w profilu: {sizes}. To kilka sekund.",
    action: "Wybierz rozmiar",
    reason: "jesteś zapisany(-a) na sezon {season}",
  },
  sub: {
    requestSubject: "{team} szuka: {spots}, {when}",
    requestHeading: "{team} potrzebuje zmiennika",
    requestLead: "{teams}, {when}. {team} szuka: {spots}.",
    fromCaptain: "Od kapitana: {note}",
    hold: "Stuknij „I'm in”, żeby zająć miejsce. Kapitan potwierdzi, a odpowiedź dostaniesz e-mailem.",
    seeRequests: "Zobacz prośby o zmiennika",
    freeAgentReason:
      "jesteś wolnym zawodnikiem w sezonie {season} i masz wtedy czas",
    playerReason: "grasz w sezonie {season}, a twoja drużyna wtedy nie gra",
    claimedSubject: "{player} chce zagrać jako zmiennik: {when}",
    claimedHeading: "{player} może zagrać jako zmiennik",
    claimedLead: "{player} zajmuje miejsce na mecz {teams}, {when}.",
    claimedMore:
      "Zatwierdź, żeby ta osoba wiedziała, że gra, albo odrzuć, żeby zwolnić miejsce.",
    approveOrDecline: "Zatwierdź lub odrzuć",
    captainReason: "jesteś kapitanem drużyny {team}, która szuka zmienników",
    withdrawnSubject: "{player} jednak nie może zagrać: {when}",
    withdrawnHeading: "Zmiennik zrezygnował",
    withdrawnLead:
      "{player} nie może już zagrać w meczu {teams}, {when}. Miejsce jest znowu wolne.",
    seeYourRequest: "Zobacz swoją prośbę",
    approvedSubject: "Grasz jako zmiennik w drużynie {team}: {when}",
    approvedHeading: "Grasz!",
    approvedLead:
      "Kapitan drużyny {team} się zgodził. Grasz w meczu {teams}, {when}.",
    approvedMore:
      "Załóż coś w kolorze drużyny, jeśli możesz. Jeśli plany się zmienią, zrezygnuj na stronie zmienników, żeby mogli znaleźć kogoś innego.",
    seeDetails: "Zobacz szczegóły",
    offeredReason: "zgłosiłeś(-aś) się jako zmiennik do drużyny {team}",
    declinedSubject: "{team} ma komplet: {when}",
    declinedHeading: "Dzięki za zgłoszenie",
    declinedLead:
      "Kapitan drużyny {team} ma już komplet na mecz {teams}, {when}. Dzięki, że się zgłosiłeś(-aś).",
    cancelledSubject: "{team} nie potrzebuje już zmienników: {when}",
    cancelledHeading: "Prośba wycofana",
    cancelledLead:
      "{team} wycofała prośbę o zmienników na mecz {teams}, {when}, więc w nim nie grasz. Dzięki za zgłoszenie.",
  },
  survey: {
    subject: "Jak było w sezonie {season}?",
    lead: "Pięć krótkich pytań o sezon, około dwóch minut. Odpowiedzi są anonimowe: liga widzi sumy i komentarze, nigdy autorów.",
    action: "Wypełnij ankietę",
    reason: "grałeś(-aś) w sezonie {season}",
  },
  suspension: {
    subject: "Jesteś zawieszony(-a): {length}",
    heading: "Jesteś zawieszony(-a)",
    banned: "Po zgłoszeniu incydentu {league} na stałe zakazała ci gry.",
    suspended:
      "Po zgłoszeniu incydentu {league} zawiesiła cię na {length} w sezonie {season}.",
    lastsGames:
      "Zawieszenie maleje, gdy mecze twojej drużyny stają się ostateczne, i kończy się samo, gdy zostaną rozegrane.",
    lastsSeason: "Kończy się wraz z końcem sezonu.",
    lastsPermanent: "Trwa, dopóki liga go nie zniesie.",
    meaning:
      "W czasie zawieszenia nie możesz potwierdzać udziału w meczach, zajmować miejsca zmiennika ani trafić do drużyny z puli wolnych zawodników. Kapitan widzi, że jesteś zawieszony(-a), ale nie widzi dlaczego.",
    appealTo:
      "Aby się odwołać, odpowiedz na ten e-mail albo napisz na {email} i napisz, co liga powinna wiedzieć.",
    appeal:
      "Aby się odwołać, odpowiedz na ten e-mail i napisz, co liga powinna wiedzieć.",
    reason: "liga zawiesiła cię po zgłoszeniu incydentu",
  },
  teamRole: {
    offeredSubject:
      "{captain} prosi cię o objęcie funkcji kapitana drużyny {team}",
    offeredHeading: "Zostaniesz kapitanem drużyny {team}?",
    offeredLead:
      "{captain} chce, żebyś przejął(-ęła) funkcję kapitana drużyny {team} w sezonie {season}.",
    offeredMore:
      "Nic się nie zmieni, dopóki się nie zgodzisz. Kapitan zarządza składem, zaproszeniami, płatnościami i wicekapitanami; obecny kapitan zostanie wicekapitanem.",
    answer: "Odpowiedz na stronie drużyny",
    playReason: "grasz w drużynie {team}",
    acceptedSubject: "{player} jest teraz kapitanem drużyny {team}",
    acceptedHeading: "Twoja drużyna ma nowego kapitana",
    acceptedLead:
      "{player} się zgadza: od teraz jest kapitanem drużyny {team} w sezonie {season}.",
    acceptedMore:
      "Zostajesz wicekapitanem — ze składami meczowymi, prośbami o zmienników i wynikami. Nowy kapitan może to zmienić.",
    offeredReason: "zaproponowałeś(-aś) funkcję kapitana osobie {player}",
    declinedSubject: "{player} nie przejmie drużyny {team}",
    declinedHeading: "Nadal jesteś kapitanem",
    declinedLead:
      "{player} odmawia funkcji kapitana drużyny {team}, więc zostajesz kapitanem w sezonie {season}.",
    declinedMore:
      "Możesz zaproponować ją innemu koledze z drużyny na stronie drużyny.",
    coSubject: "Jesteś wicekapitanem drużyny {team}",
    coHeading: "Jesteś wicekapitanem",
    coLead:
      "Pomagasz teraz prowadzić drużynę {team} w sezonie {season}: ustalasz kolejność kopania, prosisz o zmienników, wpisujesz i potwierdzasz wyniki i widzisz, kto zapłacił.",
    coMore: "Możesz zrezygnować na stronie drużyny, kiedy chcesz.",
    playerSubject: "Nie jesteś już wicekapitanem drużyny {team}",
    playerHeading: "Wracasz do gry jako zawodnik",
    playerLead:
      "Grasz w drużynie {team} w sezonie {season} jako zawodnik, bez narzędzi wicekapitana.",
  },
  volunteer: {
    subject: "Jutro: twoja zmiana ({role})",
    heading: "Dzięki za wolontariat!",
    lead: "Jesteś zapisany(-a): {role}, {occasion}, {when}.",
    leadAt: "Jesteś zapisany(-a): {role}, {occasion}, {when}, {place}.",
    drop: "Jednak nie dasz rady? Zrezygnuj ze zmiany w aplikacji, żeby ktoś inny mógł ją wziąć.",
    action: "Zobacz swoje zmiany",
    reason: "zapisałeś(-aś) się na zmianę wolontariusza",
  },
  winBack: {
    reason:
      "grałeś(-aś) wcześniej w lidze, a zapisy na sezon {season} są otwarte",
  },
};
