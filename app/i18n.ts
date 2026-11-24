// Interface text in English and Bengali.
//
// Place and landmark names stay as data in BirdFlight.tsx, keyed by their English
// label; `placeName` looks up the established Bengali spelling here. Key caps
// (W, Ctrl, Enter) and the three-letter minimap codes are deliberately left in
// Latin script in both languages.

export type Locale = "en" | "bn";
export const LOCALES: Locale[] = ["bn", "en"];

const en = {
  // Document and canvas
  worldLabel: "Interactive 3D flight map of Dhaka",
  language: "Language",
  brandName: "Bird's Eye View",

  // Welcome screen
  titleScreen: "Welcome screen",
  titleWordmark: "পাখির চোখে ঢাকা",
  titleLead: "Fly over Greater Dhaka and its rivers as one of the city's own birds, with the roads, weather and daylight it has right now.",
  birdLabel: "Fly as",
  birdGroup: "Choose your bird",
  birdFlyAs: "Fly as {name}",
  birdCrow: "House crow",
  birdCrowNote: "The grey-collared regular of every rooftop.",
  birdDoel: "Magpie-robin",
  birdDoelNote: "The national bird, black and white with a long tail.",
  birdShalik: "Common myna",
  birdShalikNote: "Brown and bold, with a yellow bill and white wing flashes.",
  birdChil: "Black kite",
  birdChilNote: "The fork-tailed raptor that soars over the city all day.",
  birdTiya: "Rose-ringed parakeet",
  birdTiyaNote: "Green and loud, with a red bill and a long tail.",
  birdMachhranga: "White-throated kingfisher",
  birdMachhrangaNote: "Electric blue wings, a chestnut head and a heavy red bill.",
  launchLabel: "Take off from",
  launchGroup: "Choose where to take off from",
  launchFrom: "Take off from {name}",
  startFlight: "Take off",
  startKeyHint: "Enter",
  startTouchHint: "Tap",
  loadLoading: "Building Dhaka from OpenStreetMap…",
  loadLive: "City ready, with the live map and traffic",
  loadFallback: "Using the saved map. The live map did not load.",
  hintSteer: "Steer",
  hintFlap: "Flap",
  hintBrake: "Brake",
  hintLand: "Land",
  hintTouchSteer: "Drag to steer",
  hintTouchFlap: "Tap to flap",
  hintTouchBoost: "Hold to boost",
  factLandmarks: "{count} landmarks",
  factExtent: "24 km of city",

  // Top bar
  soundMute: "Mute nature ambience",
  soundEnable: "Enable nature ambience",
  soundOnTitle: "Nature ambience on",
  soundOffTitle: "Turn on nature ambience",
  radioOpen: "Open sky radio",
  skyOpen: "Choose time of day",
  flightResume: "Resume flight",
  flightPause: "Pause flight",
  controlsOpen: "Show flight controls",

  // Weather
  weatherDetail: "Feels like {temperature}°C · Wind {wind} km/h",
  weatherLive: "LIVE",
  weatherSync: "SYNC",
  weatherOffline: "OFFLINE",
  weatherClear: "Clear",
  weatherMostlyClear: "Mostly clear",
  weatherPartlyCloudy: "Partly cloudy",
  weatherOvercast: "Overcast",
  weatherFoggy: "Foggy",
  weatherDrizzle: "Drizzle",
  weatherRain: "Rain",
  weatherThunderstorm: "Thunderstorm",
  weatherCloudy: "Cloudy",
  weatherLoading: "Weather loading",

  // Sky panel
  skyPanel: "Time of day",
  skyClose: "Close time of day",
  skyHeading: "SKY OVER DHAKA",
  skyBody: "The sun, stars, and city lights follow Dhaka's real clock. Borrow another hour to see the river basin at its best.",
  skyPresets: "Time of day presets",
  skyLive: "LIVE",
  skyDawn: "DAWN",
  skyNoon: "NOON",
  skyGolden: "GOLDEN",
  skyDusk: "DUSK",
  skyNight: "NIGHT",
  skyFollowing: "FOLLOWING LIVE DHAKA TIME",
  skyHeld: "HELD AT A CHOSEN HOUR · WEATHER STAYS LIVE",

  // Radio
  radioPanel: "Sky radio player",
  radioClose: "Close radio",
  radioHeading: "SKY RADIO",
  radioOnAir: "ON AIR",
  radioTuning: "TUNING",
  radioPaused: "PAUSED",
  radioSignalLost: "SIGNAL LOST",
  radioOff: "OFF",
  radioUnavailable: "This station is unavailable right now. Try again or switch frequencies.",
  radioPrevious: "Previous station",
  radioNext: "Next station",
  radioPlayStation: "Play station",
  radioTurnOff: "Turn radio off",
  radioPlay: "PLAY",
  radioVolumeShort: "VOL",
  radioVolume: "Radio volume",
  radioStations: "Available stations",
  radioTune: "Tune {name}",
  radioLiveTag: "LIVE",
  radioPower: "POWER",
  radioTuneKey: "TUNE",
  radioOfficial: "OFFICIAL STATION ↗",
  radioNote: "LIVE INTERNET RADIO · SIGNAL AVAILABILITY MAY VARY",
  radioNowPlaying: "Show now playing station",

  // Flight HUD
  telemetry: "Flight telemetry",
  unitSpeed: "KM/H",
  unitAltitude: "METRES",
  unitVertical: "VERT M/S",
  unitHeading: "HEADING",
  modeCruise: "CRUISE",
  modeBraking: "BRAKING",
  modeSurge: "SURGE",
  modeClimb: "CLIMB",
  modeDive: "DIVE",
  modeSlowGlide: "SLOW GLIDE",
  compassPoints: "N,NE,E,SE,S,SW,W,NW",
  minimap: "Mini map of the Greater Dhaka river basin flight grid",
  minimapNorth: "N",
  minimapCaption: "GREATER DHAKA BASIN",
  inspectLandmark: "Inspect {name}",
  camera: "CAMERA",
  cameraChase: "CHASE",
  cameraBirdsEye: "BIRD'S EYE",
  perchLegend: "AREA PERCH",
  hintClimbDive: "CLIMB / DIVE",
  hintBrakeKey: "BRAKE",
  hintBoostKey: "BOOST",
  perchLand: "LAND",
  perchTakeOff: "TAKE OFF",
  perchLanding: "LANDING · {name}",
  perchLandAt: "LAND · {name}",
  perchRangeCancel: "{distance} M · E CANCELS",
  perchRange: "{distance} M",
  inspecting: "INSPECTING LANDMARK",
  inspectReturn: "RETURN TO BIRD",
  resting: "RESTING · WATCHING DHAKA",
  share: "SHARE THIS SPOT",
  shareCopied: "LINK COPIED",
  shareFailed: "COPY MANUALLY",
  shareFallback: "COPY THIS LINK",
  shareLink: "Shareable link to this spot",
  mapSourceLive: "OSM + PROCEDURAL + SAMPLED SIM TRAFFIC · ",
  mapSourceLoading: "LOADING MAP + SIM TRAFFIC · ",
  mapSourceFallback: "MAP + SIM TRAFFIC FALLBACK · ",
  mapAttribution: "© OpenStreetMap contributors",
  noteTouch: "TOUCH FLIGHT · DRAG TO STEER",
  noteKeyboard: "KEYBOARD FLIGHT · WASD TO STEER",

  // Touch controls
  touchControls: "Touch flight controls",
  touchStick: "Flight steering pad: drag to bank and to climb or dive",
  touchBrake: "BRAKE",
  touchBrakeHint: "Hold to air-brake",
  touchBoost: "BOOST",
  touchBoostHint: "Hold to surge forward",
  touchCamera: "CAM",
  touchCameraHint: "Switch camera",
  touchSites: "SITES",
  touchSitesHint: "Inspect next landmark",
  touchLand: "LAND",
  touchFly: "FLY",
  touchLandHint: "Land or take off",
  touchFlap: "FLAP",
  touchFlapHint: "Flap wings for lift",

  // Flight manual
  manualClose: "Close controls",
  manualHeading: "FLIGHT MANUAL",
  manualTitle: "Fly like a bird",
  manualPad: "Pad",
  manualPadText: "Drag to bank, climb, and dive",
  manualFlap: "Flap",
  manualFlapTouchText: "Tap for a burst of lift",
  manualBrake: "Brake",
  manualBrakeTouchText: "Hold to fall into a slow glide",
  manualBoost: "Boost",
  manualBoostTouchText: "Hold for a high-speed surge",
  manualCam: "Cam",
  manualCamText: "Switch between chase and first person",
  manualSites: "Sites",
  manualSitesText: "Tour the landmarks one by one",
  manualLand: "Land",
  manualLandTouchText: "Settle on a perch or treetop, then fly off",
  manualClimbDive: "Climb / dive",
  manualBank: "Bank left / right",
  manualFlapText: "Flap for a burst of lift",
  manualBrakeText: "Air-brake into a slow glide",
  manualBoostText: "Accelerate into a high-speed surge",
  manualCameraText: "Switch camera",
  manualInspectText: "Inspect next landmark",
  manualPauseText: "Pause / resume flight",
  manualLandText: "Land / take off at a perch or treetop",
  manualMinimap: "Minimap",
  manualMinimapText: "Tap a pink diamond to fly the camera to that landmark",
  manualSkyText: "Hold the sky at dawn, noon, golden hour, or night",
  manualSoundText: "Nature ambience: birds, leaves, water, and breeze",
  manualRadioText: "Radio power / tune station",

  // Pause
  pauseDialog: "Flight paused",
  pauseHeading: "FLIGHT SUSPENDED",
  pauseTitle: "Take a breath.",
  pauseBody: "Your place in the sky is waiting.",
  pauseResume: "RESUME FLIGHT",
  pauseHint: "PRESS P TO CONTINUE",

  // Screen-reader status
  statusReady: "Ready for takeoff.",
  statusPaused: "Flight paused.",
  statusResting: "Perched and watching Dhaka.",
  statusFlyingLive: "Flying over Dhaka. Map loaded from OpenStreetMap.",
  statusFlyingLoading: "Flying over Dhaka. Map still loading.",
  statusFlyingFallback: "Flying over Dhaka. Map using the offline snapshot.",

  // 3D labels
  metroLine: "MRT 6",
};

export type Strings = { [Key in keyof typeof en]: string };

const bn: Strings = {
  worldLabel: "ঢাকার ওপর দিয়ে ওড়ার ত্রিমাত্রিক মানচিত্র",
  language: "ভাষা",
  brandName: "Bird's Eye View",

  titleScreen: "শুরুর পর্দা",
  titleWordmark: "পাখির চোখে ঢাকা",
  titleLead: "শহরের নিজের পাখি হয়ে উড়ে বেড়াও বৃহত্তর ঢাকা আর তার নদীগুলোর ওপর দিয়ে। রাস্তা, আবহাওয়া আর দিনের আলো, সবই এই মুহূর্তের।",
  birdLabel: "কোন পাখি হয়ে উড়বে",
  birdGroup: "পাখি বেছে নাও",
  birdFlyAs: "{name} হয়ে ওড়ো",
  birdCrow: "পাতিকাক",
  birdCrowNote: "ধূসর গলার, ছাদে ছাদে ঘুরে বেড়ানো চেনা পাখি।",
  birdDoel: "দোয়েল",
  birdDoelNote: "জাতীয় পাখি, সাদা-কালো, লম্বা লেজের গায়ক।",
  birdShalik: "ভাত শালিক",
  birdShalikNote: "বাদামি, সাহসী, হলুদ ঠোঁট আর ডানায় সাদা ঝলক।",
  birdChil: "ভুবন চিল",
  birdChilNote: "চেরা লেজের শিকারি, সারা দিন শহরের আকাশে চক্কর দেয়।",
  birdTiya: "সবুজ টিয়া",
  birdTiyaNote: "সবুজ, মুখর, লাল ঠোঁট আর লম্বা লেজ।",
  birdMachhranga: "সাদাবুক মাছরাঙা",
  birdMachhrangaNote: "ঝলমলে নীল ডানা, খয়েরি মাথা আর মোটা লাল ঠোঁট।",
  launchLabel: "কোথা থেকে উড়বে",
  launchGroup: "কোথা থেকে উড়বে বেছে নাও",
  launchFrom: "{name} থেকে উড়াল দাও",
  startFlight: "উড়াল দাও",
  startKeyHint: "Enter",
  startTouchHint: "ট্যাপ",
  loadLoading: "ওপেনস্ট্রিটম্যাপ থেকে ঢাকা তৈরি হচ্ছে…",
  loadLive: "শহর তৈরি, লাইভ মানচিত্র আর যানবাহনসহ",
  loadFallback: "সংরক্ষিত মানচিত্র ব্যবহার হচ্ছে। লাইভ মানচিত্র লোড হয়নি।",
  hintSteer: "ঘোরো",
  hintFlap: "ডানা ঝাপটাও",
  hintBrake: "গতি কমাও",
  hintLand: "নামো",
  hintTouchSteer: "টেনে ঘোরো",
  hintTouchFlap: "ট্যাপ করে ডানা ঝাপটাও",
  hintTouchBoost: "চেপে ধরে গতি বাড়াও",
  factLandmarks: "{count}টি স্থাপনা",
  factExtent: "২৪ কিমি জুড়ে শহর",

  soundMute: "প্রকৃতির শব্দ বন্ধ করো",
  soundEnable: "প্রকৃতির শব্দ চালু করো",
  soundOnTitle: "প্রকৃতির শব্দ চালু আছে",
  soundOffTitle: "প্রকৃতির শব্দ চালু করো",
  radioOpen: "আকাশ রেডিও খোলো",
  skyOpen: "দিনের সময় বেছে নাও",
  flightResume: "আবার ওড়ো",
  flightPause: "উড়াল থামাও",
  controlsOpen: "ওড়ার নিয়ম দেখো",

  weatherDetail: "অনুভূত হচ্ছে {temperature}°সে · বাতাস ঘণ্টায় {wind} কিমি",
  weatherLive: "লাইভ",
  weatherSync: "আনছে",
  weatherOffline: "অফলাইন",
  weatherClear: "পরিষ্কার আকাশ",
  weatherMostlyClear: "প্রায় পরিষ্কার",
  weatherPartlyCloudy: "আংশিক মেঘলা",
  weatherOvercast: "মেঘে ঢাকা",
  weatherFoggy: "কুয়াশা",
  weatherDrizzle: "গুঁড়ি গুঁড়ি বৃষ্টি",
  weatherRain: "বৃষ্টি",
  weatherThunderstorm: "বজ্রঝড়",
  weatherCloudy: "মেঘলা",
  weatherLoading: "আবহাওয়া আসছে",

  skyPanel: "দিনের সময়",
  skyClose: "সময়ের প্যানেল বন্ধ করো",
  skyHeading: "ঢাকার আকাশ",
  skyBody: "সূর্য, তারা আর শহরের আলো চলে ঢাকার আসল ঘড়ি ধরে। চাইলে অন্য কোনো সময় বেছে নাও, নদীঘেরা শহরটাকে তার সেরা আলোয় দেখতে।",
  skyPresets: "দিনের সময়ের তালিকা",
  skyLive: "লাইভ",
  skyDawn: "ভোর",
  skyNoon: "দুপুর",
  skyGolden: "সোনালি বিকেল",
  skyDusk: "গোধূলি",
  skyNight: "রাত",
  skyFollowing: "ঢাকার এখনকার সময় ধরে চলছে",
  skyHeld: "বেছে নেওয়া সময়ে স্থির · আবহাওয়া লাইভই থাকছে",

  radioPanel: "আকাশ রেডিও",
  radioClose: "রেডিওর প্যানেল বন্ধ করো",
  radioHeading: "আকাশ রেডিও",
  radioOnAir: "সম্প্রচার চলছে",
  radioTuning: "টিউন হচ্ছে",
  radioPaused: "থেমে আছে",
  radioSignalLost: "সংকেত নেই",
  radioOff: "বন্ধ",
  radioUnavailable: "স্টেশনটি এখন পাওয়া যাচ্ছে না। আবার চেষ্টা করো, নয়তো অন্য স্টেশনে যাও।",
  radioPrevious: "আগের স্টেশন",
  radioNext: "পরের স্টেশন",
  radioPlayStation: "স্টেশন চালাও",
  radioTurnOff: "রেডিও বন্ধ করো",
  radioPlay: "চালাও",
  radioVolumeShort: "শব্দ",
  radioVolume: "রেডিওর শব্দের মাত্রা",
  radioStations: "স্টেশনের তালিকা",
  radioTune: "{name} ধরো",
  radioLiveTag: "লাইভ",
  radioPower: "চালু-বন্ধ",
  radioTuneKey: "স্টেশন বদল",
  radioOfficial: "স্টেশনের ওয়েবসাইট ↗",
  radioNote: "লাইভ ইন্টারনেট রেডিও · সংকেত সব সময় না-ও মিলতে পারে",
  radioNowPlaying: "চলতি স্টেশন দেখো",

  telemetry: "উড়ালের তথ্য",
  unitSpeed: "কিমি/ঘণ্টা",
  unitAltitude: "মিটার",
  unitVertical: "ওঠানামা মি/সে",
  unitHeading: "দিক",
  modeCruise: "স্বাভাবিক উড়াল",
  modeBraking: "গতি কমছে",
  modeSurge: "তীব্র গতি",
  modeClimb: "ওপরে উঠছ",
  modeDive: "নিচে নামছ",
  modeSlowGlide: "ধীরে ভাসছ",
  compassPoints: "উ,উ-পূ,পূ,দ-পূ,দ,দ-প,প,উ-প",
  minimap: "বৃহত্তর ঢাকার ছোট মানচিত্র",
  minimapNorth: "উ",
  minimapCaption: "বৃহত্তর ঢাকা",
  inspectLandmark: "{name} কাছ থেকে দেখো",
  camera: "ক্যামেরা",
  cameraChase: "পেছন থেকে",
  cameraBirdsEye: "পাখির চোখে",
  perchLegend: "বসার জায়গা",
  hintClimbDive: "ওঠা / নামা",
  hintBrakeKey: "গতি কমাও",
  hintBoostKey: "গতি বাড়াও",
  perchLand: "নামো",
  perchTakeOff: "উড়াল দাও",
  perchLanding: "নামছ · {name}",
  perchLandAt: "নামো · {name}",
  perchRangeCancel: "{distance} মি · E চাপলে বাতিল",
  perchRange: "{distance} মি",
  inspecting: "স্থাপনা দেখছ",
  inspectReturn: "পাখির কাছে ফেরো",
  resting: "জিরিয়ে নিচ্ছ · ঢাকা দেখছ",
  share: "এই জায়গাটা শেয়ার করো",
  shareCopied: "লিংক কপি হয়েছে",
  shareFailed: "নিজে কপি করো",
  shareFallback: "এই লিংকটা কপি করো",
  shareLink: "এই জায়গার শেয়ার করার লিংক",
  mapSourceLive: "ওএসএম মানচিত্র + বানানো ভবন + নমুনা যানবাহন · ",
  mapSourceLoading: "মানচিত্র আর যানবাহন লোড হচ্ছে · ",
  mapSourceFallback: "সংরক্ষিত মানচিত্র আর যানবাহন · ",
  mapAttribution: "© OpenStreetMap-এর অবদানকারীরা",
  noteTouch: "স্পর্শে উড়াল · টেনে ঘোরো",
  noteKeyboard: "কিবোর্ডে উড়াল · WASD দিয়ে ঘোরো",

  touchControls: "স্পর্শে ওড়ার নিয়ন্ত্রণ",
  touchStick: "ওড়ার প্যাড: টেনে ডানে-বাঁয়ে ঘোরো, ওপরে ওঠো বা নিচে নামো",
  touchBrake: "ধীরে",
  touchBrakeHint: "চেপে ধরে গতি কমাও",
  touchBoost: "জোরে",
  touchBoostHint: "চেপে ধরে জোরে ছোটো",
  touchCamera: "ক্যামেরা",
  touchCameraHint: "ক্যামেরা বদলাও",
  touchSites: "স্থাপনা",
  touchSitesHint: "পরের স্থাপনা দেখো",
  touchLand: "নামো",
  touchFly: "ওড়ো",
  touchLandHint: "নামো বা উড়াল দাও",
  touchFlap: "ঝাপটা",
  touchFlapHint: "ওপরে উঠতে ডানা ঝাপটাও",

  manualClose: "ওড়ার নিয়ম বন্ধ করো",
  manualHeading: "ওড়ার নিয়ম",
  manualTitle: "পাখির মতো ওড়ো",
  manualPad: "প্যাড",
  manualPadText: "টেনে ঘোরো, ওঠো আর নামো",
  manualFlap: "ঝাপটা",
  manualFlapTouchText: "ট্যাপ করলে একঝটকায় ওপরে",
  manualBrake: "ধীরে",
  manualBrakeTouchText: "চেপে ধরলে ধীরে ভেসে চলা",
  manualBoost: "জোরে",
  manualBoostTouchText: "চেপে ধরলে তীব্র গতি",
  manualCam: "ক্যামেরা",
  manualCamText: "পেছন থেকে আর পাখির চোখে, দুই দৃশ্যের মধ্যে বদল",
  manualSites: "স্থাপনা",
  manualSitesText: "একে একে সব স্থাপনা ঘুরে দেখো",
  manualLand: "নামো",
  manualLandTouchText: "বসার জায়গায় বা গাছের মাথায় নামো, তারপর আবার ওড়ো",
  manualClimbDive: "ওঠা / নামা",
  manualBank: "বাঁয়ে / ডানে ঘোরা",
  manualFlapText: "ডানা ঝাপটে একঝটকায় ওপরে ওঠা",
  manualBrakeText: "গতি কমিয়ে ধীরে ভাসা",
  manualBoostText: "গতি বাড়িয়ে তীব্র বেগে ছোটা",
  manualCameraText: "ক্যামেরা বদল",
  manualInspectText: "পরের স্থাপনা দেখা",
  manualPauseText: "থামা / আবার ওড়া",
  manualLandText: "বসার জায়গায় বা গাছের মাথায় নামা / ওড়া",
  manualMinimap: "ছোট মানচিত্র",
  manualMinimapText: "গোলাপি হীরায় ট্যাপ করলে ক্যামেরা সেই স্থাপনায় চলে যাবে",
  manualSkyText: "আকাশকে ভোর, দুপুর, সোনালি বিকেল বা রাতে ধরে রাখো",
  manualSoundText: "প্রকৃতির শব্দ: পাখি, পাতা, পানি আর হাওয়া",
  manualRadioText: "রেডিও চালু-বন্ধ / স্টেশন বদল",

  pauseDialog: "উড়াল থেমে আছে",
  pauseHeading: "উড়াল থেমে আছে",
  pauseTitle: "একটু দম নাও।",
  pauseBody: "আকাশে তোমার জায়গাটা অপেক্ষায় আছে।",
  pauseResume: "আবার ওড়ো",
  pauseHint: "চালিয়ে যেতে P চাপো",

  statusReady: "উড়াল দিতে প্রস্তুত।",
  statusPaused: "উড়াল থেমে আছে।",
  statusResting: "বসে বসে ঢাকা দেখছ।",
  statusFlyingLive: "ঢাকার ওপর দিয়ে উড়ছ। মানচিত্র ওপেনস্ট্রিটম্যাপ থেকে লোড হয়েছে।",
  statusFlyingLoading: "ঢাকার ওপর দিয়ে উড়ছ। মানচিত্র এখনো লোড হচ্ছে।",
  statusFlyingFallback: "ঢাকার ওপর দিয়ে উড়ছ। সংরক্ষিত মানচিত্র ব্যবহার হচ্ছে।",

  metroLine: "এমআরটি ৬",
};

export const STRINGS: Record<Locale, Strings> = { en, bn };

// Established Bengali spellings, keyed by the English label used as data.
export const PLACE_NAMES_BN: Record<string, string> = {
  // Landmarks
  "Holy Rosary Church": "হলি রোজারি চার্চ",
  "Bashundhara City": "বসুন্ধরা সিটি",
  "Hatirjheel Amphitheatre": "হাতিরঝিল অ্যাম্ফিথিয়েটার",
  "Police Plaza Concord": "পুলিশ প্লাজা কনকর্ড",
  "BRAC Centre": "ব্র্যাক সেন্টার",
  "Four Points by Sheraton": "ফোর পয়েন্টস বাই শেরাটন",
  "Jatiya Sangsad Bhaban": "জাতীয় সংসদ ভবন",
  "Lalbagh Fort": "লালবাগের কেল্লা",
  "Ahsan Manzil": "আহসান মঞ্জিল",
  "Central Shaheed Minar": "কেন্দ্রীয় শহীদ মিনার",
  "Curzon Hall": "কার্জন হল",
  "Baitul Mukarram": "বায়তুল মোকাররম",
  "Bangladesh Bank Tower": "বাংলাদেশ ব্যাংক ভবন",
  "Hazrat Shahjalal Airport": "হযরত শাহজালাল বিমানবন্দর",
  // Launch sites
  "Sangsad Bhaban": "সংসদ ভবন",
  "Old Dhaka": "পুরান ঢাকা",
  "Hatirjheel": "হাতিরঝিল",
  "Shahjalal Airport": "শাহজালাল বিমানবন্দর",
  // Neighbourhoods
  "Moghbazar": "মগবাজার",
  "Tejgaon I/A": "তেজগাঁও শিল্পাঞ্চল",
  "Niketan": "নিকেতন",
  "Gulshan 1": "গুলশান ১",
  "Badda Link Road": "বাড্ডা লিংক রোড",
  "Rampura Bridge": "রামপুরা ব্রিজ",
  "Karwan Bazar": "কারওয়ান বাজার",
  "Banglamotor": "বাংলামোটর",
  "Malibagh": "মালিবাগ",
  "Mohakhali": "মহাখালী",
  "Banani": "বনানী",
  "Gulshan 2": "গুলশান ২",
  "Merul Badda": "মেরুল বাড্ডা",
  "Aftabnagar": "আফতাবনগর",
  "Banasree": "বনশ্রী",
  "Dhanmondi": "ধানমন্ডি",
  "Farmgate": "ফার্মগেট",
  "Shahbagh": "শাহবাগ",
  "Ramna": "রমনা",
  "Motijheel": "মতিঝিল",
  "Khilgaon": "খিলগাঁও",
  "Agargaon": "আগারগাঁও",
  "Baridhara": "বারিধারা",
  "Kuril": "কুড়িল",
  "Bashundhara R/A": "বসুন্ধরা আবাসিক এলাকা",
  "Mohammadpur": "মোহাম্মদপুর",
  "Mirpur 1": "মিরপুর ১",
  "Mirpur 10": "মিরপুর ১০",
  "Pallabi": "পল্লবী",
  "Dhaka Cantonment": "ঢাকা সেনানিবাস",
  "Uttara": "উত্তরা",
  "Uttara Sector 3": "উত্তরা সেক্টর ৩",
  "Diabari": "দিয়াবাড়ি",
  "Purbachal": "পূর্বাচল",
  "Demra": "ডেমরা",
  "Jatrabari": "যাত্রাবাড়ী",
  "Lalbagh": "লালবাগ",
  "Sadarghat": "সদরঘাট",
  "Kamrangirchar": "কামরাঙ্গীরচর",
  "Keraniganj": "কেরানীগঞ্জ",
  // Water
  "Hatirjheel Lake": "হাতিরঝিল",
  "Dhanmondi Lake": "ধানমন্ডি লেক",
  "Gulshan Lake": "গুলশান লেক",
  "Buriganga River": "বুড়িগঙ্গা নদী",
  "Turag River": "তুরাগ নদ",
  "Tongi Khal": "টঙ্গী খাল",
  "Balu River": "বালু নদী",
  "Shitalakshya River": "শীতলক্ষ্যা নদী",
  // MRT Line 6 stations not already listed above
  "Uttara North": "উত্তরা উত্তর",
  "Bijoy Sarani": "বিজয় সরণি",
  "Dhaka University": "ঢাকা বিশ্ববিদ্যালয়",
  "Secretariat": "বাংলাদেশ সচিবালয়",
  // Opportunistic perches
  "Treetop": "গাছের মাথা",
};

// Radio stations are data in BirdFlight.tsx; these are their Bengali names.
export const STATION_TEXT_BN: Record<string, { name: string; tagline: string }> = {
  "monsoon": { name: "বর্ষার আমেজ", tagline: "ঝিরিঝিরি বৃষ্টি · দূরের ঘণ্টাধ্বনি · বিরতিহীন" },
  "foorti": { name: "রেডিও ফুর্তি", tagline: "বাংলাদেশ থেকে সরাসরি" },
  "dhaka-fm": { name: "ঢাকা এফএম", tagline: "ঢাকার গুলশান থেকে সরাসরি" },
  "jago": { name: "জাগো এফএম", tagline: "ঢাকা থেকে সরাসরি" },
};

/** A station's name and tagline in the UI language. */
export function stationText(locale: Locale, station: { id: string; name: string; tagline: string }) {
  return (locale === "bn" ? STATION_TEXT_BN[station.id] : undefined) ?? { name: station.name, tagline: station.tagline };
}

const BENGALI_DIGITS = ["০", "১", "২", "৩", "৪", "৫", "৬", "৭", "৮", "৯"];

/** Western digits rewritten in Bengali numerals when the locale calls for it. */
export function localDigits(locale: Locale, value: string | number) {
  const text = String(value);
  if (locale !== "bn") return text;
  return text.replace(/\d/g, (digit) => BENGALI_DIGITS[Number(digit)]);
}

/** Fill `{name}` placeholders in a string from the table. */
export function fill(template: string, values: Record<string, string | number>) {
  return template.replace(/\{(\w+)\}/g, (match, key: string) => (key in values ? String(values[key]) : match));
}

/** The name to show for a place whose data label is English. */
export function placeName(locale: Locale, label: string) {
  return locale === "bn" ? PLACE_NAMES_BN[label] ?? label : label;
}

/** Text for a floating 3D label: a place name, or a station on the metro line. */
export function worldLabelText(locale: Locale, label: string, onMetro = false) {
  const name = placeName(locale, label);
  return onMetro ? `${name} · ${STRINGS[locale].metroLine}` : name;
}

const WEATHER_KEYS: Record<string, keyof Strings> = {
  "Clear": "weatherClear",
  "Mostly clear": "weatherMostlyClear",
  "Partly cloudy": "weatherPartlyCloudy",
  "Overcast": "weatherOvercast",
  "Foggy": "weatherFoggy",
  "Drizzle": "weatherDrizzle",
  "Rain": "weatherRain",
  "Thunderstorm": "weatherThunderstorm",
  "Cloudy": "weatherCloudy",
  "Weather loading": "weatherLoading",
};

/** The weather service answers in English; show its label in the UI language. */
export function weatherLabel(locale: Locale, label: string) {
  const key = WEATHER_KEYS[label];
  return key ? STRINGS[locale][key] : label;
}

/** A frequency such as "88.0 FM" in the UI language. */
export function frequencyText(locale: Locale, frequency: string) {
  if (locale !== "bn" || !frequency.endsWith(" FM")) return frequency;
  return `${localDigits(locale, frequency.slice(0, -3))} এফএম`;
}

// The chosen language lives outside React so the 3D scene, which is built once,
// can read it through a ref while components subscribe to changes.
const LOCALE_STORAGE_KEY = "bev-locale";
const localeListeners = new Set<() => void>();
let chosenLocale: Locale | null = null;

function isLocale(value: string | null | undefined): value is Locale {
  return value === "en" || value === "bn";
}

/** Explicit choice, then `?lang=`, then the saved choice, then the browser. */
export function readLocale(): Locale {
  if (chosenLocale) return chosenLocale;
  const requested = new URLSearchParams(window.location.search).get("lang");
  if (isLocale(requested)) return requested;
  try {
    const saved = window.localStorage.getItem(LOCALE_STORAGE_KEY);
    if (isLocale(saved)) return saved;
  } catch {
    // Storage can be blocked; fall through to the browser language.
  }
  return window.navigator.language.toLowerCase().startsWith("bn") ? "bn" : "en";
}

export function chooseLocale(locale: Locale) {
  chosenLocale = locale;
  try {
    window.localStorage.setItem(LOCALE_STORAGE_KEY, locale);
  } catch {
    // The choice still holds for this visit.
  }
  localeListeners.forEach((listener) => listener());
}

export function subscribeToLocale(listener: () => void) {
  localeListeners.add(listener);
  return () => {
    localeListeners.delete(listener);
  };
}
