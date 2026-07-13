import { createHash, randomUUID } from "node:crypto";
import { access, mkdir, open, readdir, readFile, rename, rm, stat, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { pathToFileURL } from "node:url";

const TASK_ID = "course-catalog-ux";
const TASK_GOAL =
  "优化懂币猫前台交易实战课程的列表、未授权详情和已授权学习路径，消除重复、含混和低效操作；每个页面先用真实字段出高保真图，经用户确认后再实施。";
const WORKSPACE_ROOT = "/Users/linlifu/Documents/New project";
const TASK_ROOT = join(WORKSPACE_ROOT, ".codex", "tasks", TASK_ID);
const TASK_AGENTS_FILE = join(TASK_ROOT, "AGENTS.md");
const ADVISOR_WORKSPACE = TASK_ROOT;
const TASK_OUTPUTS_DIR = join(TASK_ROOT, "outputs");
const BRIDGE_ROOT = "/Volumes/SSD 500G/quant_research/devspace_bridge/devspace";
const RUNTIME_PATH = join(BRIDGE_ROOT, "dist", "local-agent-runtime.js");
const STATE_ROOT = "/Users/linlifu/.local/share/devspace/advisor-inbox";
const TASK_STATE_ROOT = join(STATE_ROOT, TASK_ID);
const ARCHIVE_DIR = join(TASK_STATE_ROOT, "archive");
const LATEST_PATH = join(TASK_STATE_ROOT, "latest.json");
const STATE_PATH = join(TASK_STATE_ROOT, "state.json");
const LOCK_PATH = join(TASK_STATE_ROOT, "advisor.lock");
const COMPLETE_DECISION = /^COURSEUX_\d{8}T\d{6}Z_[a-z0-9][a-z0-9-]*_decision\.md$/;
const ARTIFACT_GLOB = "COURSEUX_[0-9]{8}T[0-9]{6}Z_*_decision.md";

const SOURCE_SCOPE = [
  TASK_AGENTS_FILE,
  `${TASK_OUTPUTS_DIR}/<selected decision/checks/guards only>`,
];
const WRITE_SCOPE = [
  TASK_STATE_ROOT,
  "No workspace write is available to GPT advisor; Codex owns task-local artifacts.",
];

const dryRun = process.argv.includes("--dry-run");
const force = process.argv.includes("--force");
const selfTest = process.argv.includes("--self-test");

function hash(content) {
  return createHash("sha256").update(content).digest("hex");
}

function safeJson(content, name) {
  try {
    return JSON.parse(content);
  } catch {
    throw new Error(`${name} is not valid JSON; fail closed.`);
  }
}

function validateDecision(name, content) {
  const markers = [
    `TASK_ID: ${TASK_ID}`,
    `TASK_GOAL: ${TASK_GOAL}`,
    "DECISION_STATUS:",
    "## EVIDENCE",
    "## CODEX CHECK",
    "## CURRENT BOTTLENECK",
    "## ONE_ALLOWED_NEXT_STEP",
  ];
  for (const marker of markers) {
    if (!content.includes(marker)) throw new Error(`${name} is incomplete: missing ${marker}`);
  }
  if (!/DECISION_STATUS:\s*(PASS|FAILURE|BLOCKED|ACTIVE)\b/.test(content)) {
    throw new Error(`${name} has an unsupported status; fail closed.`);
  }
}

function ignoredArtifact(name) {
  return name.startsWith(".") || name.startsWith("._") || name.includes(".tmp");
}

function sectionBody(content, heading) {
  const match = content.match(new RegExp(`^## ${heading}\\s*$([\\s\\S]*?)(?=^## |\\Z)`, "m"));
  return match?.[1]?.trim() || "";
}

async function selectLatestDecision() {
  const names = await readdir(TASK_OUTPUTS_DIR);
  const candidates = [];
  for (const name of names) {
    if (ignoredArtifact(name)) continue;
    if (!name.startsWith("COURSEUX_") || !name.endsWith("_decision.md")) continue;
    if (!COMPLETE_DECISION.test(name)) {
      throw new Error(`Invalid task decision-like artifact ${name}; fail closed.`);
    }
    candidates.push(name);
  }

  const rows = await Promise.all(
    candidates.map(async (name) => {
      const decisionPath = join(TASK_OUTPUTS_DIR, name);
      const metadata = await stat(decisionPath);
      if (!metadata.isFile()) throw new Error(`${name} is not a regular file.`);
      const decisionContent = await readFile(decisionPath, "utf8");
      validateDecision(name, decisionContent);

      const stem = name.slice(0, -"_decision.md".length);
      const checksName = `${stem}_checks.json`;
      const checksPath = join(TASK_OUTPUTS_DIR, checksName);
      const checksContent = await readFile(checksPath, "utf8");
      const checks = safeJson(checksContent, checksName);
      if (checks.taskId !== TASK_ID || checks.decision !== name || !checks.status) {
        throw new Error(`${checksName} does not match ${name}; fail closed.`);
      }

      const guardsRequired = /GUARDS_REQUIRED:\s*true\b/i.test(decisionContent);
      const guardsName = `${stem}_guards.json`;
      const guardsPath = join(TASK_OUTPUTS_DIR, guardsName);
      let guardsContent = "";
      try {
        guardsContent = await readFile(guardsPath, "utf8");
      } catch (error) {
        if (error?.code !== "ENOENT" || guardsRequired) {
          throw new Error(`${guardsName} is required or unreadable; fail closed.`);
        }
      }
      if (guardsContent) {
        const guards = safeJson(guardsContent, guardsName);
        if (guards.taskId !== TASK_ID || guards.decision !== name || !guards.status) {
          throw new Error(`${guardsName} does not match ${name}; fail closed.`);
        }
      }

      return {
        name,
        decisionPath,
        decisionContent,
        checksName,
        checksPath,
        checksContent,
        guardsName: guardsContent ? guardsName : null,
        guardsPath: guardsContent ? guardsPath : null,
        guardsContent,
        modifiedMs: metadata.mtimeMs,
        hashes: {
          decision: hash(decisionContent),
          checks: hash(checksContent),
          guards: guardsContent ? hash(guardsContent) : null,
        },
      };
    }),
  );
  rows.sort((left, right) => right.modifiedMs - left.modifiedMs || right.name.localeCompare(left.name));
  if (!rows[0]) throw new Error(`No complete decision matching ${ARTIFACT_GLOB}; fail closed.`);
  return rows[0];
}

async function readOptional(path) {
  try {
    return await readFile(path, "utf8");
  } catch (error) {
    if (error?.code === "ENOENT") return null;
    throw error;
  }
}

function validateStateRecord(record) {
  const required = [
    "TASK_ID",
    "TASK_GOAL",
    "REVIEWED_ARTIFACT",
    "REVIEW_TIME",
    "REVIEW_STATUS",
    "GPT_REVIEW",
    "CODEX_CHECK",
    "CURRENT_BOTTLENECK",
    "NEXT_ALLOWED_STEP",
    "FAILURE_REASON",
    "SOURCE_SCOPE",
    "WRITE_SCOPE",
    "HASH",
    "REVIEW_ARCHIVE",
  ];
  for (const key of required) {
    if (!(key in record)) throw new Error(`Task state is missing ${key}; fail closed.`);
  }
  if (record.TASK_ID !== TASK_ID || record.TASK_GOAL !== TASK_GOAL) {
    throw new Error("Task state belongs to a different task or goal; fail closed.");
  }
}

async function readExistingState() {
  const [latestRaw, stateRaw] = await Promise.all([readOptional(LATEST_PATH), readOptional(STATE_PATH)]);
  if ((latestRaw === null) !== (stateRaw === null)) {
    throw new Error("latest/state pair is incomplete; fail closed.");
  }
  if (latestRaw === null) return null;
  const latest = safeJson(latestRaw, "latest.json");
  const state = safeJson(stateRaw, "state.json");
  validateStateRecord(latest);
  validateStateRecord(state);
  if (latestRaw !== stateRaw) throw new Error("latest/state content differs; fail closed.");
  const archiveRaw = await readFile(state.REVIEW_ARCHIVE, "utf8");
  if (archiveRaw !== latestRaw) throw new Error("archive/latest content differs; fail closed.");
  return latest;
}

function stateMatches(record, decision) {
  return (
    record.REVIEWED_ARTIFACT === decision.name &&
    record.REVIEWED_ARTIFACT_PATH === decision.decisionPath &&
    record.MODIFIED_MS === decision.modifiedMs &&
    record.HASH?.decision === decision.hashes.decision &&
    record.HASH?.checks === decision.hashes.checks &&
    record.HASH?.guards === decision.hashes.guards
  );
}

async function atomicWrite(path, content) {
  await mkdir(dirname(path), { recursive: true, mode: 0o700 });
  const temporary = join(dirname(path), `.${randomUUID()}.tmp`);
  await writeFile(temporary, content, { encoding: "utf8", flag: "wx", mode: 0o600 });
  await rename(temporary, path);
}

function reviewSections(response) {
  const expected = [
    "REVIEWED EVIDENCE",
    "GOAL GAP",
    "BOTTLENECK",
    "ROUTE OPTIONS",
    "RECOMMENDED ONE STEP",
    "ADVERSARIAL CHECK",
  ];
  const matches = [
    ...response.matchAll(
      /^#{1,3}\s*(REVIEWED EVIDENCE|GOAL GAP|BOTTLENECK|ROUTE OPTIONS|RECOMMENDED ONE STEP|ADVERSARIAL CHECK)\s*:?\s*$/gim,
    ),
  ];
  const actual = matches.map((match) => match[1].toUpperCase());
  if (actual.length !== expected.length || actual.some((heading, index) => heading !== expected[index])) {
    throw new Error("GPT review must contain exactly six required sections in order; fail closed.");
  }
  return Object.fromEntries(
    expected.map((heading, index) => [
      heading,
      response.slice(matches[index].index + matches[index][0].length, matches[index + 1]?.index).trim(),
    ]),
  );
}

function validateReview(response, decision) {
  const sections = reviewSections(response);
  const evidence = sections["REVIEWED EVIDENCE"];
  for (const required of [
    decision.name,
    decision.decisionPath,
    decision.hashes.decision,
    "只读",
    "时间边界",
  ]) {
    if (!evidence.includes(required)) {
      throw new Error(`REVIEWED EVIDENCE is missing ${required}; fail closed.`);
    }
  }
  const routes = sections["ROUTE OPTIONS"];
  const routeMarkers = routes.match(/(?:路线|Route)\s*(?:A|B|C|1|2|一|二|三)/gi) || [];
  if (routeMarkers.length < 2) {
    throw new Error("ROUTE OPTIONS must compare at least two meaningful routes; fail closed.");
  }
  return sections;
}

function selfTestContract() {
  const decision = {
    name: "COURSEUX_20260713T000000Z_self-test_decision.md",
    decisionPath: "/tmp/COURSEUX_20260713T000000Z_self-test_decision.md",
    hashes: { decision: "a".repeat(64) },
  };
  const response = [
    `## REVIEWED EVIDENCE\n- ${decision.name}\n- ${decision.decisionPath}\n- ${decision.hashes.decision}\n- 权限：只读\n- 时间边界：2026-07-13`,
    "## GOAL GAP\n已确认与未确认",
    "## BOTTLENECK\none",
    "## ROUTE OPTIONS\n路线 A：a\n路线 B：b",
    "## RECOMMENDED ONE STEP\none",
    "## ADVERSARIAL CHECK\ncheck",
  ].join("\n\n");
  validateReview(response, decision);
  let rejected = false;
  try {
    validateReview(response.replace("路线 B：b", ""), decision);
  } catch {
    rejected = true;
  }
  if (!rejected) throw new Error("Advisor contract self-test accepted one route.");
  for (const ignored of ["._COURSEUX_x_decision.md", ".hidden.tmp", "COURSEUX_x.tmp_decision.md"]) {
    if (!ignoredArtifact(ignored)) throw new Error(`Temporary artifact was not excluded: ${ignored}`);
  }
  const tied = [
    { name: "COURSEUX_20260713T000000Z_a_decision.md", modifiedMs: 1 },
    { name: "COURSEUX_20260713T000000Z_b_decision.md", modifiedMs: 1 },
  ];
  tied.sort((left, right) => right.modifiedMs - left.modifiedMs || right.name.localeCompare(left.name));
  if (tied[0].name !== "COURSEUX_20260713T000000Z_b_decision.md") {
    throw new Error("Deterministic filename tie-break failed.");
  }
  console.log(JSON.stringify({ status: "self-test-passed", checks: 4 }));
}

async function writeReviewRecord(decision, response, status, failureReason = "") {
  let sections = {};
  if (response && status === "PASS") sections = validateReview(response, decision);
  const reviewTime = new Date().toISOString();
  const archivePath = join(ARCHIVE_DIR, `${reviewTime.replaceAll(":", "-")}_${randomUUID()}.json`);
  const codexCheck = sectionBody(decision.decisionContent, "CODEX CHECK");
  const record = {
    TASK_ID,
    TASK_GOAL,
    REVIEWED_ARTIFACT: decision.name,
    REVIEWED_ARTIFACT_PATH: decision.decisionPath,
    REVIEW_TIME: reviewTime,
    REVIEW_STATUS: status,
    GPT_REVIEW: response,
    CODEX_CHECK: codexCheck,
    CURRENT_BOTTLENECK: sections["BOTTLENECK"] || sectionBody(decision.decisionContent, "CURRENT BOTTLENECK"),
    NEXT_ALLOWED_STEP: sections["RECOMMENDED ONE STEP"] || sectionBody(decision.decisionContent, "ONE_ALLOWED_NEXT_STEP"),
    FAILURE_REASON: failureReason,
    SOURCE_SCOPE,
    WRITE_SCOPE,
    HASH: {
      ...decision.hashes,
      gptReview: hash(response || failureReason),
    },
    MODIFIED_MS: decision.modifiedMs,
    REVIEW_ARCHIVE: archivePath,
  };
  const serialized = `${JSON.stringify(record, null, 2)}\n`;
  await mkdir(ARCHIVE_DIR, { recursive: true, mode: 0o700 });
  await writeFile(archivePath, serialized, { encoding: "utf8", flag: "wx", mode: 0o600 });
  await atomicWrite(LATEST_PATH, serialized);
  await atomicWrite(STATE_PATH, serialized);

  const [archiveRaw, latestRaw, stateRaw] = await Promise.all([
    readFile(archivePath, "utf8"),
    readFile(LATEST_PATH, "utf8"),
    readFile(STATE_PATH, "utf8"),
  ]);
  if (archiveRaw !== latestRaw || latestRaw !== stateRaw) {
    throw new Error("Published archive/latest/state are inconsistent; fail closed.");
  }
  const published = safeJson(stateRaw, "state.json");
  validateStateRecord(published);
  if (!stateMatches(published, decision)) {
    throw new Error("Published state does not match authoritative decision; fail closed.");
  }
  return archivePath;
}

async function lockExists() {
  try {
    await access(LOCK_PATH);
    return true;
  } catch (error) {
    if (error?.code === "ENOENT") return false;
    throw error;
  }
}

async function main() {
  if (selfTest) {
    selfTestContract();
    return;
  }
  await mkdir(TASK_STATE_ROOT, { recursive: true, mode: 0o700 });
  if (await lockExists()) throw new Error("advisor.lock exists; fail closed.");
  await access(RUNTIME_PATH);
  const decision = await selectLatestDecision();
  const previous = await readExistingState();
  const unchanged = previous && stateMatches(previous, decision);

  if (dryRun || (unchanged && !force)) {
    console.log(
      JSON.stringify({
        status: dryRun ? "dry-run" : "unchanged",
        taskId: TASK_ID,
        latest: decision.name,
        modifiedMs: decision.modifiedMs,
        hashes: decision.hashes,
        reviewRequired: !unchanged || force,
      }),
    );
    return;
  }

  let lock;
  try {
    lock = await open(LOCK_PATH, "wx", 0o600);
  } catch (error) {
    if (error?.code === "EEXIST") throw new Error("advisor.lock conflict; fail closed.");
    throw error;
  }

  try {
    const agents = await readFile(TASK_AGENTS_FILE, "utf8");
    const prompt = [
      "You are the read-only GPT strategic planner for one isolated current-thread task.",
      `TASK_ID: ${TASK_ID}`,
      `TASK_GOAL: ${TASK_GOAL}`,
      "Do not infer a project-wide goal and do not read or use any other task's state, artifacts, conclusions, numbering, or next step.",
      "The only authoritative evidence is embedded below. Do not use model memory as evidence and do not modify or execute anything.",
      "Return exactly six Markdown sections in this order: REVIEWED EVIDENCE; GOAL GAP; BOTTLENECK; ROUTE OPTIONS; RECOMMENDED ONE STEP; ADVERSARIAL CHECK.",
      `REVIEWED EVIDENCE must include the full filename ${decision.name}, full path ${decision.decisionPath}, exact decision hash ${decision.hashes.decision}, read scope, evidence time boundary, and 只读 permission.`,
      "GOAL GAP must separate confirmed, unconfirmed, missing evidence, forbidden work, and unsupported conclusions.",
      "BOTTLENECK must identify exactly one highest-leverage task bottleneck and show why later work is unreliable without it.",
      "ROUTE OPTIONS must label and compare at least 路线 A and 路线 B, including surface, evidence, runnable capability, risk, acceptance, and elimination criteria.",
      "RECOMMENDED ONE STEP must name one bounded step, code/data surface, whether it enters real data or writes files, capability, acceptance, elimination, remaining blocker, and separate-authorization need.",
      "ADVERSARIAL CHECK must cover relevant facts, assumptions, future information, lookahead, repainting, leakage, selection bias, overfitting, scope, and state-consistency risks; mark irrelevant research risks as not applicable with reasons.",
      "This task is design-first. Product source remains read-only until the user confirms a high-fidelity design. No deploy, backend, database, payment, production, external, or Open portfolio action is allowed.",
      "--- TASK RULES ---",
      agents,
      `--- DECISION ${decision.name} ---`,
      decision.decisionContent,
      `--- CHECKS ${decision.checksName} ---`,
      decision.checksContent,
      decision.guardsContent ? `--- GUARDS ${decision.guardsName} ---\n${decision.guardsContent}` : "",
    ].join("\n\n");

    const module = await import(pathToFileURL(RUNTIME_PATH).href);
    const runtime = await module.createCodexSdkLocalAgentRuntime();
    const result = await runtime.run({
      workspace: ADVISOR_WORKSPACE,
      writeMode: "read_only",
      model: "gpt-5.6-sol",
      thinking: "medium",
      prompt,
    });
    const archivePath = await writeReviewRecord(decision, result.finalResponse, "PASS");
    console.log(
      JSON.stringify({
        status: "reviewed",
        taskId: TASK_ID,
        latest: decision.name,
        archivePath,
        responseCharacters: result.finalResponse.length,
      }),
    );
  } catch (error) {
    const failure = error instanceof Error ? error.message : String(error);
    try {
      const latestDecision = await selectLatestDecision();
      await writeReviewRecord(latestDecision, "", "FAILURE", failure);
    } catch {
      // Preserve the original error; inconsistent state must not be overwritten.
    }
    throw error;
  } finally {
    await lock?.close();
    await rm(LOCK_PATH, { force: true });
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
