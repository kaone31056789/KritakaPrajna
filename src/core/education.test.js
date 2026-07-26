import {
  parseJsonReply,
  scoreEducationModel,
  formatTokens,
  formatSpend,
  scheduleNext,
  dueIndexes,
  rotate,
  mergeTopics,
  trimDigest,
  blendedCost,
  inPriceBand,
  salvageTopics,
  looksLikePastPaper,
  validateSet,
  isChatModel,
  dropFrontMatter,
  isMetaQuestion,
  isMetaTitle,
  candidatesFor,
  setPins,
  pinnedFor,
  clearPins,
  dueAcross,
  forecast,
  retentionForecast,
  streak,
  GRADE,
} from "./education";
import { supportsVision } from "../utils/smartModelSelect";
import { modelsStore, isFreeModel } from "./models";
import { keysStore } from "./keys";
import { calculateCost } from "../utils/costTracker";

const DAY = 86400000;

const free = { prompt: 0, completion: 0 };

/* The two pieces that break silently: pulling JSON back out of a chatty model
   reply, and the fitness bar that decides which models the picker offers. */

describe("parseJsonReply", () => {
  test("survives a code fence and surrounding prose", () => {
    const out = parseJsonReply('Sure!\n```json\n{"cards":[{"q":"a","a":"b"}]}\n```\nHope that helps.');
    expect(out.cards[0].q).toBe("a");
  });

  test("handles a bare array and nested braces", () => {
    expect(parseJsonReply('[{"n":1,"meta":{"x":2}}]')[0].meta.x).toBe(2);
  });

  test("returns null rather than throwing on junk", () => {
    expect(parseJsonReply("no json here")).toBeNull();
    expect(parseJsonReply('{"broken": ')).toBeNull();
    expect(parseJsonReply("")).toBeNull();
  });
});

describe("scoreEducationModel", () => {
  const PAID_BAR = 34; // BAR.paid in education.js

  test("a current-generation long-context model clears the bar and says why", () => {
    const { score, why } = scoreEducationModel({
      id: "anthropic/claude-opus-4",
      context_length: 200000,
    });
    expect(score).toBeGreaterThanOrEqual(PAID_BAR);
    expect(why).toContain("current generation");
    expect(why).toContain("200k+ context");
  });

  test("newest wins: a current model beats a famous older one", () => {
    const now = scoreEducationModel({ id: "openai/gpt-5.1", context_length: 128000 });
    const old = scoreEducationModel({ id: "meta-llama/llama-3.1-70b-instruct", context_length: 128000 });
    expect(now.score).toBeGreaterThan(old.score);
    expect(now.why).toContain("current generation");
  });

  test("a tiny short-context model never gets routed work", () => {
    expect(scoreEducationModel({ id: "some/tiny-1b-chat", context_length: 4096 }).score)
      .toBeLessThan(PAID_BAR);
  });

  test("image generators are excluded outright", () => {
    expect(scoreEducationModel({ id: "x/flux", _isImageGen: true }).score).toBe(-1);
  });

  test("the read job refuses anything that cannot see", () => {
    const blind = { id: "deepseek/deepseek-r1", context_length: 64000 };
    const seeing = { ...blind, architecture: { modality: "text+image->text" } };
    expect(scoreEducationModel(blind, "read").score).toBe(-1);
    expect(scoreEducationModel(seeing, "read").why).toContain("reads handwriting");
  });

  test("marking weighs judgement over context; authoring weighs context", () => {
    const long = { id: "openai/gpt-5.1", context_length: 200000 };
    expect(scoreEducationModel(long, "author").score).toBeGreaterThan(
      scoreEducationModel(long, "mark").score
    );
  });

  test("a reasoning model beats a same-generation instruct model", () => {
    const reasoner = scoreEducationModel({ id: "deepseek/deepseek-r1", context_length: 128000 });
    const instruct = scoreEducationModel({ id: "meta-llama/llama-4-scout", context_length: 128000 });
    expect(reasoner.score).toBeGreaterThan(instruct.score);
    expect(reasoner.why).toContain("reasoning model");
  });

  test("a small model loses to a frontier reasoner despite a new family name", () => {
    const small = scoreEducationModel({
      id: "meta-llama/llama-4-maverick-17b-128e",
      name: "Llama 4 Maverick 17B 128E",
      context_length: 128000,
    });
    const big = scoreEducationModel({ id: "deepseek/deepseek-r1", context_length: 128000 });
    expect(big.score).toBeGreaterThan(small.score);
  });

  test("reasoning models outside the shared allowlist still count here", () => {
    const { why } = scoreEducationModel({
      id: "nvidia/nemotron-3-ultra",
      name: "Nemotron 3 Ultra",
      context_length: 128000,
    });
    expect(why).toContain("reasoning model");
  });
});

describe("parallel read worker assignment", () => {
  const chain = ["a", "b", "c"];

  test("each worker starts on a different model", () => {
    expect(rotate(chain, 0)[0]).toBe("a");
    expect(rotate(chain, 1)[0]).toBe("b");
    expect(rotate(chain, 2)[0]).toBe("c");
  });

  test("every worker keeps the whole chain as its own fallback", () => {
    for (let i = 0; i < 5; i++) {
      expect(rotate(chain, i).slice().sort()).toEqual(["a", "b", "c"]);
    }
  });

  test("more workers than models wraps around instead of running dry", () => {
    expect(rotate(chain, 4)[0]).toBe("b");
  });

  test("a single-model chain is left alone", () => {
    expect(rotate(["only"], 3)).toEqual(["only"]);
    expect(rotate([], 2)).toEqual([]);
  });
});

describe("tiers", () => {
  // $/1M blended = (prompt*0.7 + completion*0.3) * 1e6
  const cheapReasoner = {
    id: "deepseek/deepseek-r1",
    context_length: 128000,
    pricing: { prompt: 0.0000004, completion: 0.0000016 }, // ~$0.76 /1M
  };
  const flagship = {
    id: "anthropic/claude-opus-4",
    context_length: 200000,
    pricing: { prompt: 0.000015, completion: 0.000075 }, // ~$33 /1M
  };

  test("blended cost weights input, which is what long notes actually are", () => {
    expect(blendedCost(cheapReasoner)).toBeCloseTo(0.76, 2);
    expect(blendedCost(flagship)).toBeCloseTo(33, 0);
    expect(blendedCost({ pricing: { prompt: 0, completion: 0 } })).toBe(0);
    expect(blendedCost({})).toBe(0);
  });

  test("the three tiers are exclusive price bands", () => {
    const freeModel = { pricing: { prompt: 0, completion: 0 } };
    // Free: free only.
    expect(inPriceBand(freeModel, "free")).toBe(true);
    expect(inPriceBand(cheapReasoner, "free")).toBe(false);
    // Paid: real money, but under $5 per million.
    expect(inPriceBand(cheapReasoner, "paid")).toBe(true);
    expect(inPriceBand(freeModel, "paid")).toBe(false);
    expect(inPriceBand(flagship, "paid")).toBe(false);
    // Paid+: $5 per million and up, and nothing free sneaks onto that shelf.
    expect(inPriceBand(flagship, "premium")).toBe(true);
    expect(inPriceBand(cheapReasoner, "premium")).toBe(false);
    expect(inPriceBand(freeModel, "premium")).toBe(false);
  });

  test("the Paid floor excludes a price that is free in all but name", () => {
    const dust = { pricing: { prompt: 0.00000000005, completion: 0.00000000005 } }; // $0.00005 /1M
    expect(inPriceBand(dust, "paid")).toBe(false);
    expect(inPriceBand({ pricing: { prompt: 0.0000002, completion: 0.0000002 } }, "paid")).toBe(true);
  });

  test("the band edges are the stated numbers", () => {
    const at = (perM) => ({ pricing: { prompt: perM / 1e6, completion: perM / 1e6 } });
    expect(inPriceBand(at(4.99), "paid")).toBe(true);
    expect(inPriceBand(at(5), "paid")).toBe(false);
    expect(inPriceBand(at(5), "premium")).toBe(true);
    expect(inPriceBand(at(4.99), "premium")).toBe(false);
  });

  test("Paid credits value; Paid+ does not", () => {
    const paid = scoreEducationModel(cheapReasoner, "author", "paid");
    const premium = scoreEducationModel(cheapReasoner, "author", "premium");
    expect(paid.score).toBeGreaterThan(premium.score);
    expect(paid.why).toContain("great value");
    expect(premium.why).not.toContain("great value");
  });

  test("on quality alone the flagship leads, whichever route serves it", () => {
    const cheap = scoreEducationModel(cheapReasoner, "author", "premium").score;
    for (const provider of ["anthropic", "openrouter"]) {
      const lux = scoreEducationModel({ ...flagship, _provider: provider }, "author", "premium");
      expect(lux.score).toBeGreaterThan(cheap);
      expect(lux.why).toContain("reasoning model");
    }
  });

  test("a missing pricing block counts as free, matching isFreeModel", () => {
    // NVIDIA and HuggingFace catalogues arrive without pricing; the rest of the
    // app already reads that as free, so the bands must agree — which means the
    // free tier takes it and neither paid band does.
    const noPricing = { id: "nvidia/nemotron-3-ultra", context_length: 128000 };
    expect(inPriceBand(noPricing, "free")).toBe(true);
    expect(inPriceBand(noPricing, "paid")).toBe(false);
    expect(inPriceBand(noPricing, "premium")).toBe(false);
  });

  test("the value bonus grades across the Paid band, not toward free", () => {
    const near = { id: "a/near-free", context_length: 128000, pricing: { prompt: 0.0000002, completion: 0.0000002 } };
    const mid = { id: "b/mid", context_length: 128000, pricing: { prompt: 0.0000025, completion: 0.0000025 } };
    expect(scoreEducationModel(near, "author", "paid").score).toBeGreaterThan(
      scoreEducationModel(mid, "author", "paid").score
    );
  });
});

describe("vision detection drives the read stage", () => {
  const sees = (id) => supportsVision({ id });

  test("modern free VLMs are recognised — the ones the catalogues actually ship", () => {
    // NVIDIA and HuggingFace send no architecture field, so the id is all we get.
    expect(sees("nvidia/nemotron-nano-12b-v2-vl")).toBe(true);
    expect(sees("meta/llama-4-scout-17b-16e-instruct")).toBe(true);
    expect(sees("google/gemma-3-27b-it")).toBe(true);
    expect(sees("qwen/qwen2.5-vl-72b-instruct:free")).toBe(true); // "qwen2-vl" never matched this
    expect(sees("meta-llama/llama-3.2-11b-vision-instruct:free")).toBe(true);
  });

  test("text-only models are rejected, including inside multimodal families", () => {
    expect(sees("google/gemma-3-1b-it")).toBe(false); // the 1b has no vision tower
    expect(sees("deepseek-ai/deepseek-v3.2")).toBe(false);
    expect(sees("meta-llama/llama-3.1-70b-instruct")).toBe(false);
  });

  test("the read job refuses a text-only model outright", () => {
    const blind = { id: "deepseek-ai/deepseek-v3.2", context_length: 128000 };
    expect(scoreEducationModel(blind, "read", "free").why).not.toContain("reads handwriting");
    expect(scoreEducationModel(blind, "read", "free").score).toBe(-1);
  });
});

describe("non-chat endpoints never reach the chain", () => {
  test("guard, safety, embedding and rerank models are excluded", () => {
    // The exact model that burned a whole run — nvidia.js listed
    // "nemotron-content-safety" and the live catalogue served the 3.5 version.
    expect(isChatModel({ id: "nvidia/nemotron-3.5-content-safety" })).toBe(false);
    expect(isChatModel({ id: "nvidia/llama-nemotron-rerank-vl" })).toBe(false);
    expect(isChatModel({ id: "ibm/granite-guardian-3.0-8b" })).toBe(false);
    expect(isChatModel({ id: "meta/llama-guard-4-12b" })).toBe(false);
    expect(isChatModel({ id: "nvidia/nv-embedqa-e5-v5" })).toBe(false);
    expect(isChatModel({ id: "openai/whisper-large-v3" })).toBe(false);
  });

  test("real chat models are untouched", () => {
    expect(isChatModel({ id: "nvidia/nemotron-3-ultra" })).toBe(true);
    expect(isChatModel({ id: "deepseek/deepseek-r1" })).toBe(true);
    expect(isChatModel({ id: "z-ai/glm-4.6" })).toBe(true);
    expect(isChatModel({ id: "anthropic/claude-opus-4" })).toBe(true);
  });

  test("a guard model scores as ineligible for every job", () => {
    const guard = { id: "nvidia/nemotron-3.5-content-safety", context_length: 128000 };
    for (const job of ["comprehend", "author", "mark", "read"]) {
      expect(scoreEducationModel(guard, job, "free").score).toBe(-1);
    }
  });
});

describe("rejecting a template echo", () => {
  const j = (o) => JSON.stringify(o);

  test("the literal quiz template is refused so the chain falls over to another model", () => {
    const echo = j({
      title: "...",
      questions: [{ q: "...", options: ["A", "B", "C", "D"], answer: 0, why: "why the answer is right", topic: "the topic this came from" }],
    });
    expect(validateSet("quiz", 30)(echo)).toBeNull();
  });

  test("thin material lowers the bar instead of failing forever", () => {
    // A 1,500-character practical file yields one topic; demanding 40% of twelve
    // cards from it fails every model in the chain, every time.
    const small = j({
      cards: [
        { q: "What does #include <stdio.h> do?", a: "Pulls in the standard I/O declarations." },
        { q: "What is the entry point of a C program?", a: "main()." },
      ],
    });
    expect(validateSet("flashcards", 12, 0)(small)).toBeNull(); // topic count unknown
    expect(validateSet("flashcards", 12, 1)(small)).not.toBeNull(); // one topic — two cards is fair
  });

  test("one real question when thirty were asked is still a failure", () => {
    const thin = j({
      title: "C Basics",
      questions: [
        { q: "Which header declares printf?", options: ["stdio.h", "stdlib.h", "math.h", "string.h"], answer: 0 },
      ],
    });
    expect(validateSet("quiz", 30)(thin)).toBeNull();
    expect(validateSet("quiz", 2)(thin)).not.toBeNull(); // fine if that is what you asked for
  });

  test("placeholder cards are stripped and a mostly-real deck survives", () => {
    const mixed = j({
      title: "C Basics",
      cards: [
        { q: "What does stdio.h provide?", a: "Standard input and output declarations." },
        { q: "...", a: "..." },
        { q: "What is a macro?", a: "A preprocessor text substitution." },
      ],
    });
    const out = validateSet("flashcards", 3)(mixed);
    expect(out.cards).toHaveLength(2);
  });

  test("a real deck passes untouched", () => {
    const good = j({
      title: "Control Flow",
      questions: [
        { q: "Which loop always runs once?", options: ["do-while", "while", "for", "goto"], answer: 0 },
        { q: "What does break do?", options: ["Exits the loop", "Skips one pass", "Returns", "Nothing"], answer: 0 },
      ],
    });
    expect(validateSet("quiz", 2)(good).questions).toHaveLength(2);
  });

  test("an out-of-range answer index is not a usable question", () => {
    const bad = j({ questions: [{ q: "Real question?", options: ["a", "b"], answer: 7 }] });
    expect(validateSet("quiz", 1)(bad)).toBeNull();
  });
});

describe("past-paper detection", () => {
  test("obvious filenames are caught", () => {
    expect(looksLikePastPaper("23CSH-101 End Sem Question Paper 2024.pdf")).toBe(true);
    expect(looksLikePastPaper("PYQ-2023.pdf")).toBe(true);
    expect(looksLikePastPaper("model paper.docx")).toBe(true);
  });

  test("an unhelpfully named file is caught from its opening page", () => {
    const head =
      "B.TECH SEMESTER EXAMINATION\nTime allowed: 3 hours   Maximum Marks: 70\n" +
      "Note: Answer any five questions from Section B.\nSection - A\n1. Define an algorithm. [2 marks]";
    expect(looksLikePastPaper("scan_0012.pdf", head)).toBe(true);
  });

  test("ordinary notes are not mistaken for a paper", () => {
    expect(looksLikePastPaper("Lab Manual 23CSH-101.docx", "Experiment 1: Introduction to C")).toBe(false);
    // One stray signal is not enough — lecture slides mention marks all the time.
    expect(looksLikePastPaper("unit-3-slides.pptx", "Total marks for the unit: 20")).toBe(false);
  });
});

describe("salvaging a truncated read", () => {
  test("recovers every complete topic when the model runs out of tokens mid-array", () => {
    const cut =
      '{"topics":[{"name":"Ohm\'s Law","points":["V = IR"]},' +
      '{"name":"Kirchhoff","points":["currents sum to zero"]},' +
      '{"name":"Thevenin","points":["any linear net';
    const out = salvageTopics(cut);
    expect(out.salvaged).toBe(true);
    expect(out.topics.map((t) => t.name)).toEqual(["Ohm's Law", "Kirchhoff"]);
  });

  test("a reply with no topics array is not salvageable", () => {
    expect(salvageTopics("I cannot help with that.")).toBeNull();
    expect(salvageTopics('{"topics":[')).toBeNull();
    expect(salvageTopics("")).toBeNull();
  });

  test("complete JSON still parses normally rather than going down the salvage path", () => {
    const whole = '{"topics":[{"name":"A","points":["x"]}]}';
    expect(parseJsonReply(whole).topics).toHaveLength(1);
  });
});

describe("token optimisation", () => {
  test("overlapping topics from parallel readers merge into one", () => {
    const merged = mergeTopics([
      { name: "Ohm's Law", points: ["V = IR"], terms: ["resistance — ohms"] },
      { name: "ohms law", points: ["V = IR", "applies to linear elements"], examples: ["12V / 4Ω = 3A"] },
      { name: "Kirchhoff", points: ["currents into a node sum to zero"] },
    ]);
    expect(merged).toHaveLength(2);
    const ohm = merged.find((t) => /ohm/i.test(t.name));
    expect(ohm.points).toEqual(["V = IR", "applies to linear elements"]); // no duplicate
    expect(ohm.examples).toEqual(["12V / 4Ω = 3A"]);
    expect(ohm.terms).toEqual(["resistance — ohms"]);
  });

  test("unnamed topics are dropped rather than merged under an empty key", () => {
    expect(mergeTopics([{ name: "", points: ["x"] }, { points: ["y"] }])).toHaveLength(0);
  });

  test("trimming keeps every topic and sheds depth instead", () => {
    const topics = Array.from({ length: 6 }, (_, i) => ({
      name: `Topic ${i}`,
      points: Array.from({ length: 30 }, (_, j) => `Point ${i}.${j} with a decent amount of wording in it`),
      terms: [],
      examples: [],
    }));
    const { topics: fitted, trimmed } = trimDigest(topics, 400);
    expect(trimmed).toBe(true);
    expect(fitted).toHaveLength(6); // breadth survives — no subject vanishes
    expect(fitted.every((t) => t.points.length < 30)).toBe(true);
    expect(fitted.some((t) => t.points.length > 0)).toBe(true);
  });

  test("a digest already inside budget is passed through untouched", () => {
    const topics = [{ name: "Small", points: ["one"], terms: [], examples: [] }];
    const out = trimDigest(topics, 5000);
    expect(out.trimmed).toBe(false);
    expect(out.topics).toBe(topics);
  });
});

/* The scheduler itself is covered in fsrs.test.js. These only assert that the
   hub is wired to it correctly — grades map through, and due-ness is read from
   the state FSRS produces. */
describe("metadata questions are caught at the output, whatever the topic was called", () => {
  // Every one of these actually shipped to the user under topic names
  // "Document Metadata" and "Document Structure" — names no admin-word list
  // would have contained. Filtering the question itself is what holds.
  const shipped = [
    "The practical file submitted by Parikshit Dahiya (UID 24BET10298) for Introduction to Problem Solving (24CSH-101B) contains how many total pages?",
    "Which faculty members are listed as supervising this practical file?",
    "What is the subject code for Introduction to Problem Solving as shown on the cover page?",
    "The student's UID 24BET10298 indicates which academic batch?",
    "What is the name of the university institute where this practical file was submitted?",
  ];

  test("every question from the reported screenshot is rejected", () => {
    for (const q of shipped) expect(isMetaQuestion(q)).toBe(true);
  });

  test("real subject questions are untouched", () => {
    const real = [
      "Which loop always executes its body at least once?",
      "What does the #include directive do at compile time?",
      "Given int a = 5, b = 2; what does a / b evaluate to, and why?",
      "Explain the difference between call by value and call by reference.",
      "How many bytes does a float occupy on a typical 64-bit system?",
      "Which page replacement algorithm suffers from Belady's anomaly?",
    ];
    for (const q of real) expect(isMetaQuestion(q)).toBe(false);
  });

  test("a deck of nothing but metadata fails validation entirely", () => {
    const junk = JSON.stringify({
      title: "Practical File — Student: Parikshit Dahiya (24BET10298)",
      questions: shipped.map((q) => ({ q, options: ["a", "b", "c", "d"], answer: 0 })),
    });
    expect(validateSet("quiz", 5)(junk)).toBeNull();
  });

  test("a mixed deck keeps the real questions and drops the cover-page ones", () => {
    const mixed = JSON.stringify({
      questions: [
        { q: shipped[0], options: ["65", "64", "66", "63"], answer: 0 },
        { q: "Which loop always executes at least once?", options: ["do-while", "while", "for", "goto"], answer: 0 },
        { q: "What does break do inside a loop?", options: ["Exits it", "Skips a pass", "Returns", "Nothing"], answer: 0 },
      ],
    });
    const out = validateSet("quiz", 3)(mixed);
    expect(out.questions).toHaveLength(2);
    expect(out.questions.every((q) => !isMetaQuestion(q.q))).toBe(true);
  });

  test("a cover-page title is dropped rather than shown as the deck name", () => {
    const set = JSON.stringify({
      title: "Chandigarh University Practical File — Student: Parikshit Dahiya (24BET10298)",
      cards: [
        { q: "What is a pointer?", a: "A variable holding an address." },
        { q: "What is malloc?", a: "Allocates heap memory." },
      ],
    });
    expect(validateSet("flashcards", 2)(set).title).toBe("");
  });

  test("a title that names the subject is kept", () => {
    for (const good of [
      "Introduction to Problem Solving — Control Structures",
      "Pointers, Arrays and Dynamic Memory",
      "Operating Systems: Scheduling",
    ]) {
      expect(isMetaTitle(good)).toBe(false);
    }
    for (const bad of [
      "Practical File: Introduction to Problem Solving",
      "Lab Record — Student: A. Sharma",
      "24BET10298 Submission",
    ]) {
      expect(isMetaTitle(bad)).toBe(true);
    }
  });
});

describe("front matter never reaches the questions", () => {
  const t = (name, points = ["a real substantive point about the topic"]) => ({
    name,
    points,
    terms: [],
    examples: [],
  });

  test("the exact topic that produced the bad card is dropped", () => {
    // "Course Information" became "What is the subject name and code for this
    // practical file?" — a question about the cover page.
    expect(dropFrontMatter([t("Course Information")])).toEqual([]);
  });

  test("the rest of the administrative furniture goes too", () => {
    const admin = [
      "Subject Code", "Student Details", "Table of Contents", "Certificate",
      "Acknowledgement", "Declaration", "Submitted By", "Index",
      "Department", "Semester", "Marks Distribution", "Bonafide Certificate",
    ].map((n) => t(n));
    expect(dropFrontMatter(admin)).toEqual([]);
  });

  test("real topics survive untouched", () => {
    const real = [t("Decision Control Structures"), t("Pointers and Memory"), t("Recursion")];
    expect(dropFrontMatter(real)).toHaveLength(3);
  });

  test("a content-sounding topic made only of metadata is still dropped", () => {
    const disguised = t("Experiment Setup", [
      "Name: Parikshit Dahiya",
      "Roll No: 24BET10298",
      "Submitted to: Dept. of CSE",
    ]);
    expect(dropFrontMatter([disguised])).toEqual([]);
  });

  test("a real topic keeps its content and loses only the metadata line", () => {
    const mixed = t("Loops in C", [
      "A while loop tests its condition before the first pass.",
      "Roll No: 24BET10298",
      "do-while always executes at least once.",
    ]);
    const [out] = dropFrontMatter([mixed]);
    expect(out.points).toEqual([
      "A while loop tests its condition before the first pass.",
      "do-while always executes at least once.",
    ]);
  });

  test("subject words inside a real topic name are not a false positive", () => {
    // "Information" alone must not disqualify — Information Theory is a subject.
    expect(dropFrontMatter([t("Information Theory and Coding")])).toHaveLength(1);
    expect(dropFrontMatter([t("Database Normalisation")])).toHaveLength(1);
  });
});

describe("study statistics", () => {
  const deck = (review) => [{ kind: "flashcards", payload: { cards: [{}, {}, {}, {}] }, review }];
  const seen = (daysAgo, stability) => ({
    stability,
    difficulty: 5,
    due: Date.now() + stability * DAY,
    lastReview: Date.now() - daysAgo * DAY,
    reps: 1,
    lapses: 0,
  });

  test("unseen cards count as due, so the backlog is honest", () => {
    expect(dueAcross(deck({}))).toBe(4);
    expect(dueAcross(deck({ 0: seen(0, 10), 1: seen(0, 10) }))).toBe(2);
  });

  test("the forecast puts overdue cards on today rather than off the chart", () => {
    const overdue = { ...seen(30, 5), due: Date.now() - 20 * DAY };
    const bins = forecast(deck({ 0: overdue, 1: seen(0, 3), 2: seen(0, 3), 3: seen(0, 3) }), 14);
    expect(bins[0]).toBe(1); // the overdue one, not lost
    expect(bins.reduce((a, b) => a + b, 0)).toBe(4); // every card accounted for
  });

  test("predicted recall decays over the forecast window", () => {
    const curve = retentionForecast(deck({ 0: seen(0, 10), 1: seen(0, 20) }), 30);
    expect(curve).toHaveLength(30);
    expect(curve[0]).toBeGreaterThan(curve[29]);
    expect(curve[0]).toBeLessThanOrEqual(1);
    expect(curve[29]).toBeGreaterThan(0);
  });

  test("a collection with nothing seen has no curve to draw", () => {
    expect(retentionForecast(deck({}), 30)).toEqual([]);
  });

  test("quizzes and papers are excluded — only flashcards are scheduled", () => {
    const mixed = [
      { kind: "quiz", payload: { questions: [{}, {}] } },
      { kind: "paper", payload: { sections: [] } },
      ...deck({}),
    ];
    expect(dueAcross(mixed)).toBe(4);
  });
});

describe("streak counting", () => {
  const day = (n) => ({ t: Date.now() - n * DAY, g: 3 });

  test("consecutive days count up", () => {
    expect(streak([day(0), day(1), day(2)])).toBe(3);
  });

  test("a gap ends the run", () => {
    expect(streak([day(0), day(1), day(3), day(4)])).toBe(2);
  });

  test("not having studied yet today does not break yesterday's run", () => {
    // Otherwise every streak resets at midnight, which is just wrong.
    expect(streak([day(1), day(2), day(3)])).toBe(3);
  });

  test("a run that ended two days ago is over", () => {
    expect(streak([day(2), day(3)])).toBe(0);
    expect(streak([])).toBe(0);
  });

  test("several reviews in one day are still one day", () => {
    expect(streak([day(0), day(0), day(0)])).toBe(1);
  });
});

describe("free recall marking", () => {
  // markRecall's validator is the guard between a chatty model and a grade, so
  // it is the piece worth pinning down.
  const validate = (raw) => {
    const p = parseJsonReply(raw);
    if (!p || !["correct", "partial", "wrong"].includes(p.verdict)) return null;
    return p;
  };

  test("a usable verdict passes", () => {
    const ok = '{"verdict":"partial","missing":"You did not mention the return type.","grade":2}';
    expect(validate(ok).verdict).toBe("partial");
  });

  test("an invented verdict is rejected so the chain retries", () => {
    expect(validate('{"verdict":"kinda","missing":"x","grade":2}')).toBeNull();
    expect(validate('{"missing":"x","grade":2}')).toBeNull();
    expect(validate("I think that is roughly right!")).toBeNull();
  });

  test("a hint caps the grade at Hard however well it was answered", () => {
    // Cued recall lowers retrieval demand — better today, worse in a month — so
    // it must not be able to earn the longest interval.
    const cap = (grade, hintUsed) => (hintUsed ? Math.min(grade, 2) : grade);
    expect(cap(4, true)).toBe(2);
    expect(cap(3, true)).toBe(2);
    expect(cap(1, true)).toBe(1); // never raises a wrong answer
    expect(cap(4, false)).toBe(4);
  });
});

describe("spaced repetition wiring", () => {
  test("grades map to FSRS ratings, not SM-2 quality scores", () => {
    expect([GRADE.again, GRADE.hard, GRADE.good, GRADE.easy]).toEqual([1, 2, 3, 4]);
  });

  test("scheduleNext returns FSRS state, not an ease factor", () => {
    const c = scheduleNext(null, GRADE.good);
    expect(c.stability).toBeGreaterThan(0);
    expect(c.difficulty).toBeGreaterThanOrEqual(1);
    expect(c.difficulty).toBeLessThanOrEqual(10);
    expect(c.ease).toBeUndefined();
    expect(c.interval).toBeGreaterThanOrEqual(1);
  });

  test("easy still buys a longer gap than good", () => {
    const seed = scheduleNext(scheduleNext(null, GRADE.good), GRADE.good);
    expect(scheduleNext(seed, GRADE.easy).interval).toBeGreaterThan(
      scheduleNext(seed, GRADE.good).interval
    );
  });

  test("retention is honoured through the hub, not just the module", () => {
    const seed = scheduleNext(null, GRADE.good);
    expect(scheduleNext(seed, GRADE.good, 0.95).interval).toBeLessThan(
      scheduleNext(seed, GRADE.good, 0.85).interval
    );
  });

  test("unseen cards are due; scheduled ones are not until their time", () => {
    const set = {
      payload: { cards: [{}, {}, {}] },
      review: {
        0: { due: Date.now() + 2 * DAY },
        1: { due: Date.now() - 1000 },
      },
    };
    expect(dueIndexes(set)).toEqual([1, 2]);
  });
});

describe("spend formatting", () => {
  test("token counts round to a readable magnitude", () => {
    expect(formatTokens(834)).toBe("834");
    expect(formatTokens(12400)).toBe("12.4k");
    expect(formatTokens(2_300_000)).toBe("2.3M");
  });

  test("sub-cent costs keep their digits instead of collapsing to $0.00", () => {
    expect(formatSpend(0)).toBe("free");
    expect(formatSpend(0.0031)).toBe("$0.0031");
    expect(formatSpend(1.5)).toBe("$1.50");
  });
});

describe("pinned models lead the chain, fallback stays behind", () => {
  // Priced onto the Paid+ shelf ($10 /1M) so the tier under test actually has
  // a catalogue to route through.
  const M = (id, extra = {}) => ({
    id,
    _provider: "openrouter",
    context_length: 200000,
    pricing: { prompt: 0.00001, completion: 0.00001 },
    ...extra,
  });

  const CATALOGUE = [
    M("openai/gpt-5.1"), // top of the auto ranking
    M("deepseek/deepseek-r1"),
    M("z-ai/glm-4.6"),
    M("qwen/qwen3-max"),
    M("moonshot/kimi-k2", { _provider: "nvidia" }), // no key for this one
    M("mistralai/mistral-medium-3-vl", { architecture: { modality: "text+image->text" } }),
  ];

  beforeEach(() => {
    modelsStore.set({ models: CATALOGUE });
    keysStore.set({ providers: { openrouter: "sk-test" } });
    clearPins();
  });

  afterEach(() => clearPins());

  const ids = (chain) => chain.map((m) => m.id);

  test("without a pin, the auto ranking decides", () => {
    expect(ids(candidatesFor("author", "premium"))[0]).toBe("openai/gpt-5.1");
  });

  test("a pin leads even when a higher-scoring model exists", () => {
    setPins("premium", "author", ["z-ai/glm-4.6"]);
    const chain = ids(candidatesFor("author", "premium"));
    expect(chain[0]).toBe("z-ai/glm-4.6");
    expect(chain).toContain("openai/gpt-5.1"); // the fallback did not disappear
    expect(chain.length).toBeGreaterThan(1);
  });

  test("pin order is the run order", () => {
    setPins("premium", "author", ["qwen/qwen3-max", "deepseek/deepseek-r1"]);
    expect(ids(candidatesFor("author", "premium")).slice(0, 2)).toEqual([
      "qwen/qwen3-max",
      "deepseek/deepseek-r1",
    ]);
  });

  test("a pin you hold no key for is skipped, not left as a dead head", () => {
    setPins("premium", "author", ["moonshot/kimi-k2", "z-ai/glm-4.6"]);
    const chain = ids(candidatesFor("author", "premium"));
    expect(chain).not.toContain("moonshot/kimi-k2");
    expect(chain[0]).toBe("z-ai/glm-4.6");
  });

  test("a blind model pinned to the handwriting job is refused", () => {
    setPins("premium", "read", ["deepseek/deepseek-r1", "mistralai/mistral-medium-3-vl"]);
    const chain = ids(candidatesFor("read", "premium"));
    expect(chain).not.toContain("deepseek/deepseek-r1");
    expect(chain[0]).toBe("mistralai/mistral-medium-3-vl");
  });

  test("pins are scoped per tier and per job", () => {
    setPins("premium", "author", ["z-ai/glm-4.6"]);
    expect(pinnedFor("premium", "author")).toEqual(["z-ai/glm-4.6"]);
    expect(pinnedFor("paid", "author")).toEqual([]);
    expect(pinnedFor("premium", "mark")).toEqual([]);
    expect(ids(candidatesFor("mark", "premium"))[0]).toBe("openai/gpt-5.1");
  });

  test("clearing a job's pins returns it to automatic", () => {
    setPins("premium", "author", ["z-ai/glm-4.6"]);
    setPins("premium", "author", []);
    expect(pinnedFor("premium", "author")).toEqual([]);
    expect(ids(candidatesFor("author", "premium"))[0]).toBe("openai/gpt-5.1");
  });

  test("duplicates collapse instead of wasting a chain slot", () => {
    setPins("premium", "author", ["z-ai/glm-4.6", "z-ai/glm-4.6"]);
    expect(pinnedFor("premium", "author")).toEqual(["z-ai/glm-4.6"]);
  });
});

describe("a price the catalogue will not state is not a cheap price", () => {
  // openrouter/fusion is real: 1M context, pricing { prompt: -1, completion: -1 }
  // because it fans a prompt out across a panel of models and only knows the
  // cost afterwards. Read as a number, that sentinel is negative money.
  const fusion = {
    id: "openrouter/fusion",
    name: "OpenRouter: Fusion",
    context_length: 1000000,
    pricing: { prompt: -1, completion: -1 },
  };

  test("it does not read as cheaper than every real model", () => {
    expect(blendedCost(fusion)).toBe(Infinity);
    expect(inPriceBand(fusion, "paid")).toBe(false);
  });

  test("string sentinels from the live feed are caught too", () => {
    expect(blendedCost({ pricing: { prompt: "-1", completion: "-1" } })).toBe(Infinity);
    expect(blendedCost({ pricing: { prompt: "0.0000004", completion: "0.0000016" } })).toBeCloseTo(0.76, 2);
  });

  test("an absent pricing block still means free — NVIDIA and HuggingFace send none", () => {
    expect(blendedCost({ id: "nvidia/nemotron-3-ultra" })).toBe(0);
    expect(inPriceBand({ id: "nvidia/nemotron-3-ultra" }, "free")).toBe(true);
  });

  test("it is refused by every tier, not just the one that caught it", () => {
    expect(inPriceBand(fusion, "paid")).toBe(false); // paid: unstated price
    expect(isFreeModel(fusion)).toBe(false); // free: not free
    // premium has no cost filter, so quality alone has to keep it out: a
    // million-token window and nothing else known is not enough.
    expect(scoreEducationModel(fusion, "author", "premium").score).toBeLessThan(40);
  });

  test("the value bonus cannot be farmed with a negative price", () => {
    const honest = scoreEducationModel(
      { id: "deepseek/deepseek-r1", context_length: 128000, pricing: { prompt: 0.0000004, completion: 0.0000016 } },
      "author",
      "paid"
    ).score;
    expect(scoreEducationModel(fusion, "author", "paid").score).toBeLessThan(honest);
  });

  test("an unstated price never subtracts from what you have spent", () => {
    const usage = { prompt_tokens: 10000, completion_tokens: 5000 };
    expect(calculateCost(usage, fusion.pricing)).toBe(0);
    expect(calculateCost(usage, { prompt: 0.000001, completion: 0.000002 })).toBeCloseTo(0.02, 6);
  });
});
