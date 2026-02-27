const API_ENDPOINTS = {
  status: "/api/status",
  sources: "/api/sources",
  questions: "/api/questions",
  importCsv: "/api/import-csv",
};
const STATIC_DATA_URL = "./data/question_bank.json";

const QUESTION_TYPE_LABEL = {
  choice: "选择题",
  judge: "判断题",
  blank: "填空题",
  unknown: "其他题",
};

const WRONG_BANK_KEY = "study_quiz_wrong_bank_v2";
const LEGACY_WRONG_BANK_KEY = "bio_quiz_wrong_bank_v1";

const state = {
  dataMode: "unknown",
  questions: [],
  questionMap: new Map(),
  sources: [],
  sourceMetaByFile: new Map(),
  sourceOrderByFile: new Map(),
  session: [],
  currentIndex: 0,
  answeredCount: 0,
  correctCount: 0,
  currentSubmitted: false,
  wrongBank: [],
  autoNextTimer: null,
};

const el = {
  quickFilterBar: document.getElementById("quickFilterBar"),
  sourceList: document.getElementById("sourceList"),
  bankSummary: document.getElementById("bankSummary"),
  poolHint: document.getElementById("poolHint"),
  poolCountText: document.getElementById("poolCountText"),
  typeList: document.getElementById("typeList"),
  keywordInput: document.getElementById("keywordInput"),
  clearKeywordBtn: document.getElementById("clearKeywordBtn"),
  questionCount: document.getElementById("questionCount"),
  orderMode: document.getElementById("orderMode"),
  autoNext: document.getElementById("autoNext"),
  importDbBtn: document.getElementById("importDbBtn"),
  dataModeHint: document.getElementById("dataModeHint"),
  loadBtn: document.getElementById("loadBtn"),
  startBtn: document.getElementById("startBtn"),
  wrongStartBtn: document.getElementById("wrongStartBtn"),
  exportWrongBtn: document.getElementById("exportWrongBtn"),
  clearWrongBtn: document.getElementById("clearWrongBtn"),
  totalCount: document.getElementById("totalCount"),
  progressText: document.getElementById("progressText"),
  accuracyText: document.getElementById("accuracyText"),
  wrongCountText: document.getElementById("wrongCountText"),
  progressBar: document.getElementById("progressBar"),
  statusMessage: document.getElementById("statusMessage"),
  quizPanel: document.getElementById("quizPanel"),
  summaryPanel: document.getElementById("summaryPanel"),
  focusToggleBtn: document.getElementById("focusToggleBtn"),
  questionMeta: document.getElementById("questionMeta"),
  questionIndex: document.getElementById("questionIndex"),
  questionText: document.getElementById("questionText"),
  answerArea: document.getElementById("answerArea"),
  submitBtn: document.getElementById("submitBtn"),
  revealBtn: document.getElementById("revealBtn"),
  nextBtn: document.getElementById("nextBtn"),
  resultBox: document.getElementById("resultBox"),
  summaryText: document.getElementById("summaryText"),
  restartBtn: document.getElementById("restartBtn"),
};

init();

function init() {
  state.wrongBank = loadWrongBank();
  bindEvents();
  updateWrongCount();
  loadBankAuto();
}

function bindEvents() {
  el.importDbBtn.addEventListener("click", async () => {
    await importCsvToDatabase();
  });

  el.loadBtn.addEventListener("click", () => {
    loadBankAuto();
  });

  el.startBtn.addEventListener("click", () => {
    startPractice({ wrongOnly: false });
  });

  el.wrongStartBtn.addEventListener("click", () => {
    startPractice({ wrongOnly: true });
  });

  el.exportWrongBtn.addEventListener("click", () => {
    exportWrongBankCsv();
  });

  el.clearWrongBtn.addEventListener("click", () => {
    if (!state.wrongBank.length) {
      setStatus("错题本为空。");
      return;
    }
    const confirmed = window.confirm("确定清空错题本吗？该操作不可撤销。");
    if (!confirmed) {
      return;
    }
    state.wrongBank = [];
    persistWrongBank();
    updateWrongCount();
    setStatus("已清空错题本。");
  });

  el.submitBtn.addEventListener("click", submitAnswer);
  el.revealBtn.addEventListener("click", revealAnswer);
  el.nextBtn.addEventListener("click", nextQuestion);
  el.restartBtn.addEventListener("click", () => {
    startPractice({ wrongOnly: false });
  });
  el.focusToggleBtn.addEventListener("click", toggleFocusModeFromButton);

  el.quickFilterBar.addEventListener("click", (event) => {
    const target = event.target;
    if (!(target instanceof HTMLElement)) {
      return;
    }
    const token = target.getAttribute("data-source-filter");
    if (!token) {
      return;
    }
    applySourceFilter(token);
  });

  el.sourceList.addEventListener("change", () => {
    syncPoolPreview();
  });

  el.typeList.addEventListener("change", () => {
    syncPoolPreview();
  });

  el.keywordInput.addEventListener("input", () => {
    syncPoolPreview();
  });

  el.clearKeywordBtn.addEventListener("click", () => {
    el.keywordInput.value = "";
    syncPoolPreview();
  });

  window.addEventListener("resize", () => {
    updateFocusToggleButton();
  });
}

async function apiGet(url) {
  const response = await fetch(url);
  const payload = await response.json();
  if (!response.ok || !payload.ok) {
    throw new Error(payload.error || `请求失败: ${response.status}`);
  }
  return payload.data;
}

async function apiPost(url, body = undefined) {
  const response = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const payload = await response.json();
  if (!response.ok || !payload.ok) {
    throw new Error(payload.error || `请求失败: ${response.status}`);
  }
  return payload.data;
}

async function importCsvToDatabase() {
  el.importDbBtn.disabled = true;
  setStatus("正在将 CSV 导入数据库...");

  try {
    const result = await apiPost(API_ENDPOINTS.importCsv);
    await loadBankAuto();
    setStatus(`导入完成：${result.importedFiles} 份题库，${result.importedQuestions} 题。`);
  } catch (error) {
    setStatus(`导入失败：${error.message}`, true);
  } finally {
    el.importDbBtn.disabled = false;
  }
}

async function loadBankAuto() {
  setStatus("正在加载题库...");

  const dbLoaded = await tryLoadBankFromDatabase();
  if (dbLoaded) {
    return;
  }

  const staticLoaded = await loadBankFromStaticData();
  if (staticLoaded) {
    return;
  }

  resetQuestionBank();
  setDataMode("unknown");
  setStatus("未找到可用题库数据。请启动后端或提供静态题库文件。", true);
}

async function tryLoadBankFromDatabase() {
  try {
    const status = await apiGet(API_ENDPOINTS.status);
    if (!status.ready) {
      return false;
    }

    const [sources, questions] = await Promise.all([
      apiGet(API_ENDPOINTS.sources),
      apiGet(API_ENDPOINTS.questions),
    ]);

    buildQuestionBankFromApi(sources, questions);
    setDataMode("database");
    setStatus(`数据库加载完成，共 ${state.sources.length} 份题库，${state.questions.length} 题。`);
    return true;
  } catch (error) {
    return false;
  }
}

async function loadBankFromStaticData() {
  try {
    const response = await fetch(STATIC_DATA_URL, { cache: "no-cache" });
    if (!response.ok) {
      return false;
    }
    const payload = await response.json();
    if (!payload || !Array.isArray(payload.sources) || !Array.isArray(payload.questions)) {
      return false;
    }

    buildQuestionBankFromApi(payload.sources, payload.questions);
    setDataMode("static");
    setStatus(`静态题库加载完成，共 ${state.sources.length} 份题库，${state.questions.length} 题。`);
    return true;
  } catch (error) {
    return false;
  }
}

function setDataMode(mode) {
  state.dataMode = mode;

  if (mode === "database") {
    el.importDbBtn.classList.remove("hidden");
    el.dataModeHint.textContent = "当前为数据库模式：可点击“导入 CSV 到数据库”刷新题库。";
    return;
  }

  if (mode === "static") {
    el.importDbBtn.classList.add("hidden");
    el.dataModeHint.textContent = "当前为静态题库模式：适合 GitHub Pages/Netlify 等纯静态部署。";
    return;
  }

  el.importDbBtn.classList.remove("hidden");
  el.dataModeHint.textContent = "优先使用数据库模式；若无后端，将自动切换为静态题库模式。";
}

function buildQuestionBankFromApi(rawSources, rawQuestions) {
  const sourceMetaByFile = new Map();
  const sourceList = [];

  if (Array.isArray(rawSources)) {
    for (const source of rawSources) {
      if (!source || !source.fileName) {
        continue;
      }
      const meta = normalizeSourceMeta(source);
      sourceMetaByFile.set(meta.fileName, meta);
      sourceList.push(meta);
    }
  }

  const questions = [];
  if (Array.isArray(rawQuestions)) {
    for (const raw of rawQuestions) {
      const question = normalizeApiQuestion(raw, sourceMetaByFile);
      if (!question.question) {
        continue;
      }
      questions.push(question);

      if (!sourceMetaByFile.has(question.sourceFile)) {
        const fallback = parseSourceMeta(question.sourceFile);
        sourceMetaByFile.set(question.sourceFile, {
          fileName: question.sourceFile,
          displayName: question.sourceLabel || fallback.displayName,
          subject: question.subject || fallback.subject,
          grade: question.grade || fallback.grade,
          term: question.term || fallback.term,
          questionCount: 0,
        });
      }
    }
  }

  for (const [fileName, meta] of sourceMetaByFile.entries()) {
    if (!sourceList.find((item) => item.fileName === fileName)) {
      sourceList.push(meta);
    }
  }

  const countBySource = countQuestionsBySource(questions);
  for (const source of sourceList) {
    source.questionCount = countBySource.get(source.fileName) || source.questionCount || 0;
  }

  sourceList.sort(sortSourceMeta);

  state.sources = sourceList;
  state.sourceMetaByFile = new Map(sourceList.map((item) => [item.fileName, item]));
  state.sourceOrderByFile = new Map(sourceList.map((item, index) => [item.fileName, index]));

  questions.sort(sortQuestion);
  state.questions = questions;
  state.questionMap = new Map(questions.map((question) => [question.key, question]));

  rebuildSourceSelector();
  resetPracticeState();
  syncStats();
  syncPoolPreview();
  renderBankSummary();
}

function normalizeSourceMeta(source) {
  const fallback = parseSourceMeta(String(source.fileName || ""));
  return {
    fileName: String(source.fileName || ""),
    displayName: String(source.displayName || fallback.displayName),
    subject: String(source.subject || fallback.subject),
    grade: String(source.grade || fallback.grade),
    term: String(source.term || fallback.term),
    questionCount: Number(source.questionCount || 0),
  };
}

function normalizeApiQuestion(raw, sourceMetaByFile) {
  const sourceFile = String(raw?.sourceFile || "");
  const sourceFallback = parseSourceMeta(sourceFile);
  const sourceMeta = sourceMetaByFile.get(sourceFile);

  const options = Array.isArray(raw?.options) ? raw.options.map((x) => cleanCell(x)) : [];
  while (options.length < 4) {
    options.push("");
  }

  const question = {
    key: String(raw?.key || `${sourceFile}::${raw?.id || ""}::${raw?.question || ""}`),
    id: String(raw?.id || ""),
    rawType: String(raw?.rawType || ""),
    type: normalizeType(String(raw?.type || ""), options, String(raw?.answerRaw || "")),
    question: cleanCell(raw?.question || ""),
    options,
    answerRaw: cleanCell(raw?.answerRaw || ""),
    analysis: cleanCell(raw?.analysis || ""),
    sourceFile,
    sourceLabel: String(raw?.sourceLabel || sourceMeta?.displayName || sourceFallback.displayName),
    subject: String(raw?.subject || sourceMeta?.subject || sourceFallback.subject),
    grade: String(raw?.grade || sourceMeta?.grade || sourceFallback.grade),
    term: String(raw?.term || sourceMeta?.term || sourceFallback.term),
  };

  return question;
}

function parseSourceMeta(fileName) {
  const displayName = String(fileName || "").replace(/\.csv$/i, "");

  const subject = displayName.includes("生物")
    ? "生物"
    : displayName.includes("地理")
      ? "地理"
      : "其他";

  const grade = displayName.includes("七年级")
    ? "七年级"
    : displayName.includes("八年级")
      ? "八年级"
      : "未知年级";

  const term = displayName.includes("上") ? "上册" : displayName.includes("下") ? "下册" : "";

  return {
    fileName,
    displayName,
    subject,
    grade,
    term,
  };
}

function normalizeType(rawType, options, answerRaw) {
  const t = cleanCell(rawType).replace(/[？?]/g, "").toLowerCase();

  if (/choice|选择|单选|多选|选|閫夋嫨/.test(t)) {
    return "choice";
  }
  if (/judge|判断|是非|对错|鍒ゆ柇/.test(t)) {
    return "judge";
  }
  if (/blank|填空|简答|问答|濉┖/.test(t)) {
    return "blank";
  }

  const optionCount = options.filter((item) => cleanCell(item) !== "").length;
  if (optionCount >= 2) {
    return "choice";
  }
  if (normalizeJudgeAnswer(answerRaw) !== "") {
    return "judge";
  }
  return "blank";
}

function cleanCell(value) {
  if (value === null || value === undefined) {
    return "";
  }
  let out = String(value).replace(/\uFEFF/g, "").trim();
  if (out.startsWith('"') && out.endsWith('"')) {
    out = out.slice(1, -1);
  }
  return out.replace(/\r/g, "").trim();
}

function rebuildSourceSelector() {
  if (!state.sources.length) {
    el.sourceList.innerHTML = "";
    return;
  }

  const currentSelected = new Set(getSelectedSources());
  const html = state.sources
    .map((source) => {
      const id = `source-${escapeAttribute(source.fileName)}`;
      const checked = currentSelected.size === 0 || currentSelected.has(source.fileName) ? "checked" : "";
      const label = `${source.displayName} (${source.questionCount})`;
      return `
      <label class="chip" for="${id}">
        <input id="${id}" type="checkbox" data-source="${escapeAttribute(source.fileName)}" data-subject="${escapeAttribute(source.subject)}" data-grade="${escapeAttribute(source.grade)}" ${checked}>
        <span>${escapeHtml(label)}</span>
      </label>`;
    })
    .join("");

  el.sourceList.innerHTML = html;
}

function applySourceFilter(token) {
  const checkboxes = Array.from(el.sourceList.querySelectorAll("input[type='checkbox']"));
  if (!checkboxes.length) {
    return;
  }

  if (token === "all") {
    checkboxes.forEach((item) => {
      item.checked = true;
    });
    syncPoolPreview();
    return;
  }

  if (token === "none") {
    checkboxes.forEach((item) => {
      item.checked = false;
    });
    syncPoolPreview();
    return;
  }

  const [kind, value] = token.split(":");
  if (!kind || !value) {
    return;
  }

  checkboxes.forEach((item) => {
    if (kind === "subject") {
      item.checked = item.getAttribute("data-subject") === value;
      return;
    }
    if (kind === "grade") {
      item.checked = item.getAttribute("data-grade") === value;
      return;
    }
    item.checked = false;
  });

  syncPoolPreview();
}

function startPractice({ wrongOnly }) {
  if (state.autoNextTimer) {
    clearTimeout(state.autoNextTimer);
    state.autoNextTimer = null;
  }

  const selectedTypes = getSelectedTypes();
  if (!selectedTypes.length) {
    setStatus("请至少选择一种题型。", true);
    return;
  }

  const selectedSources = getSelectedSources();
  const keywordToken = getKeywordToken();
  let pool = [];

  if (wrongOnly) {
    if (!state.wrongBank.length) {
      setStatus("错题本为空，无法开始错题重练。", true);
      return;
    }

    pool = state.wrongBank
      .map((item) => state.questionMap.get(item.key))
      .filter(Boolean);

    if (selectedSources.length > 0) {
      pool = pool.filter((question) => selectedSources.includes(question.sourceFile));
    }
  } else {
    if (!selectedSources.length) {
      setStatus("请至少选择一个题库。", true);
      return;
    }
    pool = state.questions.filter((question) => selectedSources.includes(question.sourceFile));
  }

  pool = pool.filter((question) => selectedTypes.includes(question.type));
  if (keywordToken) {
    pool = pool.filter((question) => questionMatchesKeyword(question, keywordToken));
  }

  if (!pool.length) {
    setStatus("当前筛选条件下没有可练习题目。", true);
    return;
  }

  const countInput = Number.parseInt(el.questionCount.value, 10);
  const requestedCount = Number.isFinite(countInput) && countInput > 0 ? countInput : 20;

  let arranged = pool.slice();
  if (el.orderMode.value === "random") {
    arranged = shuffle(arranged);
  } else {
    arranged.sort(sortQuestion);
  }

  const finalCount = Math.min(requestedCount, arranged.length);
  state.session = arranged.slice(0, finalCount);
  state.currentIndex = 0;
  state.answeredCount = 0;
  state.correctCount = 0;
  state.currentSubmitted = false;

  el.summaryPanel.classList.add("hidden");
  el.quizPanel.classList.remove("hidden");
  el.resultBox.classList.add("hidden");
  setQuizFocusMode(true);
  updateFocusToggleButton();

  renderCurrentQuestion();
  syncStats();

  if (wrongOnly) {
    setStatus(`已开始错题重练，本轮 ${finalCount} 题。`);
  } else {
    setStatus(`已开始练习，本轮 ${finalCount} 题。`);
  }
}

function getSelectedSources() {
  return Array.from(el.sourceList.querySelectorAll("input[type='checkbox']:checked")).map(
    (input) => input.getAttribute("data-source") || ""
  );
}

function getSelectedTypes() {
  return Array.from(el.typeList.querySelectorAll("input[type='checkbox']:checked")).map(
    (input) => input.value
  );
}

function getKeywordToken() {
  return normalizeSearchText(el.keywordInput.value || "");
}

function questionMatchesKeyword(question, keywordToken) {
  if (!keywordToken) {
    return true;
  }

  const haystack = normalizeSearchText(
    [
      question.question,
      question.analysis,
      question.sourceLabel,
      question.subject,
      question.grade,
      question.term,
      question.options.join(" "),
    ].join(" ")
  );

  return haystack.includes(keywordToken);
}

function renderCurrentQuestion() {
  const question = state.session[state.currentIndex];
  if (!question) {
    finishPractice();
    return;
  }

  state.currentSubmitted = false;
  el.submitBtn.disabled = false;
  const canReveal = question.type === "blank";
  el.revealBtn.classList.toggle("hidden", !canReveal);
  el.revealBtn.disabled = !canReveal;
  el.nextBtn.disabled = true;
  el.resultBox.className = "result-box hidden";
  el.resultBox.innerHTML = "";

  el.questionMeta.textContent = `${QUESTION_TYPE_LABEL[question.type] || "题目"} | ${question.subject} | ${question.sourceLabel}`;
  el.questionIndex.textContent = `第 ${state.currentIndex + 1} / ${state.session.length} 题`;
  el.questionText.textContent = question.question;
  el.answerArea.innerHTML = renderAnswerInputs(question);
}

function renderAnswerInputs(question) {
  if (question.type === "choice") {
    const options = question.options
      .map((option, idx) => ({
        text: cleanCell(option),
        value: String.fromCharCode(65 + idx),
      }))
      .filter((item) => item.text !== "");

    if (!options.length) {
      return '<p>该题未提供选项，可在下方按填空方式作答：</p><textarea id="textAnswer" rows="3" placeholder="请输入答案"></textarea>';
    }

    return options
      .map(
        (item) => `
      <label class="option-item">
        <input type="radio" name="answerChoice" value="${item.value}">
        <span>${escapeHtml(item.text)}</span>
      </label>
    `
      )
      .join("");
  }

  if (question.type === "judge") {
    return `
      <label class="option-item">
        <input type="radio" name="answerJudge" value="正确">
        <span>正确</span>
      </label>
      <label class="option-item">
        <input type="radio" name="answerJudge" value="错误">
        <span>错误</span>
      </label>
    `;
  }

  return `
    <label class="label" for="textAnswer">填写答案（多个空可用逗号/顿号/分号分隔）</label>
    <textarea id="textAnswer" rows="3" placeholder="请输入答案"></textarea>
  `;
}

function submitAnswer() {
  if (state.currentSubmitted) {
    return;
  }

  const question = state.session[state.currentIndex];
  if (!question) {
    return;
  }

  const userAnswer = readUserAnswer(question);
  if (!userAnswer) {
    setStatus("请先作答后再提交。", true);
    return;
  }

  const result = evaluateAnswer(question, userAnswer);
  state.currentSubmitted = true;
  state.answeredCount += 1;

  if (result.correct) {
    state.correctCount += 1;
  } else {
    recordWrongQuestion(question, userAnswer);
  }

  el.submitBtn.disabled = true;
  el.revealBtn.disabled = true;
  el.nextBtn.disabled = false;

  showResult(result, question);
  syncStats();

  if (el.autoNext.value === "on") {
    state.autoNextTimer = setTimeout(() => {
      nextQuestion();
    }, 1000);
  }
}

function revealAnswer() {
  if (state.currentSubmitted) {
    return;
  }

  const question = state.session[state.currentIndex];
  if (!question) {
    return;
  }

  if (question.type !== "blank") {
    setStatus("仅填空题支持“看答案”。", true);
    return;
  }

  const result = evaluateAnswer(question, "");
  result.correct = false;
  result.userDisplay = "（未作答，查看答案）";

  state.currentSubmitted = true;
  state.answeredCount += 1;
  recordWrongQuestion(question, result.userDisplay);

  el.submitBtn.disabled = true;
  el.revealBtn.disabled = true;
  el.nextBtn.disabled = false;

  showResult(result, question, { revealMode: true });
  syncStats();
  setStatus("已显示答案，可进入下一题。");
}

function readUserAnswer(question) {
  if (question.type === "choice") {
    const checked = el.answerArea.querySelector("input[name='answerChoice']:checked");
    return checked ? checked.value : "";
  }

  if (question.type === "judge") {
    const checked = el.answerArea.querySelector("input[name='answerJudge']:checked");
    return checked ? checked.value : "";
  }

  const text = el.answerArea.querySelector("#textAnswer");
  return text ? cleanCell(text.value) : "";
}

function evaluateAnswer(question, userAnswer) {
  if (question.type === "choice") {
    const expectedLetter = normalizeChoiceAnswer(question.answerRaw);
    const expectedOptionText = expectedLetter
      ? cleanCell(question.options[expectedLetter.charCodeAt(0) - 65] || "")
      : "";

    const expectedDisplay = expectedOptionText
      ? `${expectedLetter}（${expectedOptionText}）`
      : expectedLetter || question.answerRaw;

    return {
      correct: userAnswer === expectedLetter,
      expectedDisplay,
      userDisplay: userAnswer,
    };
  }

  if (question.type === "judge") {
    const expected = normalizeJudgeAnswer(question.answerRaw);
    return {
      correct: expected !== "" && expected === userAnswer,
      expectedDisplay: expected || question.answerRaw,
      userDisplay: userAnswer,
    };
  }

  const expectedParts = splitAnswerParts(question.answerRaw);
  const userParts = splitAnswerParts(userAnswer);
  const expectedDisplay = expectedParts.length ? expectedParts.join("，") : question.answerRaw;

  let correct = false;
  if (expectedParts.length <= 1) {
    const baseExpected = expectedParts[0] || question.answerRaw;
    correct = sameText(baseExpected, userAnswer);
  } else if (expectedParts.length === userParts.length) {
    correct = expectedParts.every((part, idx) => sameText(part, userParts[idx]));
  } else {
    correct = sameText(expectedParts.join(""), userParts.join(""));
  }

  return {
    correct,
    expectedDisplay,
    userDisplay: userAnswer,
  };
}

function showResult(result, question, options = {}) {
  const revealMode = options.revealMode === true;
  const className = revealMode
    ? "result-box"
    : result.correct
      ? "result-box ok"
      : "result-box wrong";
  const title = revealMode ? "已显示答案" : result.correct ? "回答正确" : "回答错误";
  const userAnswerHtml = renderMarkdown(result.userDisplay || "(空)");
  const correctAnswerHtml = renderMarkdown(result.expectedDisplay || question.answerRaw || "无");
  const analysis = question.analysis
    ? `
      <div class="result-section">
        <p class="result-label"><strong>解析：</strong></p>
        <div class="markdown-content">${renderMarkdown(question.analysis)}</div>
      </div>
    `
    : "";

  el.resultBox.className = className;
  el.resultBox.innerHTML = `
    <p><strong>${title}</strong></p>
    <div class="result-section">
      <p class="result-label"><strong>你的答案：</strong></p>
      <div class="markdown-content">${userAnswerHtml}</div>
    </div>
    <div class="result-section">
      <p class="result-label"><strong>正确答案：</strong></p>
      <div class="markdown-content">${correctAnswerHtml}</div>
    </div>
    ${analysis}
  `;
}

function nextQuestion() {
  if (state.autoNextTimer) {
    clearTimeout(state.autoNextTimer);
    state.autoNextTimer = null;
  }

  if (!state.currentSubmitted) {
    setStatus("请先提交当前题目。", true);
    return;
  }

  state.currentIndex += 1;
  if (state.currentIndex >= state.session.length) {
    finishPractice();
    return;
  }

  renderCurrentQuestion();
  syncStats();
}

function finishPractice() {
  el.quizPanel.classList.add("hidden");
  el.summaryPanel.classList.remove("hidden");
  setQuizFocusMode(false);
  updateFocusToggleButton();

  const total = state.session.length;
  const correct = state.correctCount;
  const wrong = Math.max(total - correct, 0);
  const rate = total ? ((correct / total) * 100).toFixed(1) : "0.0";

  el.summaryText.textContent = `本轮共 ${total} 题，答对 ${correct} 题，答错 ${wrong} 题，正确率 ${rate}%。`;
  setStatus("本轮已完成。");
}

function recordWrongQuestion(question, userAnswer) {
  const existing = state.wrongBank.find((item) => item.key === question.key);

  if (existing) {
    existing.wrongCount += 1;
    existing.lastUserAnswer = userAnswer;
    existing.updatedAt = new Date().toISOString();
  } else {
    state.wrongBank.push({
      key: question.key,
      sourceFile: question.sourceFile,
      sourceLabel: question.sourceLabel,
      subject: question.subject,
      grade: question.grade,
      term: question.term,
      type: question.type,
      prompt: question.question,
      answerRaw: question.answerRaw,
      wrongCount: 1,
      lastUserAnswer: userAnswer,
      updatedAt: new Date().toISOString(),
    });
  }

  persistWrongBank();
  updateWrongCount();
}

function loadWrongBank() {
  try {
    const rawV2 = localStorage.getItem(WRONG_BANK_KEY);
    if (rawV2) {
      const parsed = JSON.parse(rawV2);
      return Array.isArray(parsed) ? parsed.filter((item) => item && typeof item.key === "string") : [];
    }

    const rawLegacy = localStorage.getItem(LEGACY_WRONG_BANK_KEY);
    if (!rawLegacy) {
      return [];
    }

    const legacy = JSON.parse(rawLegacy);
    if (!Array.isArray(legacy)) {
      return [];
    }

    const migrated = legacy.filter((item) => item && typeof item.key === "string");
    localStorage.setItem(WRONG_BANK_KEY, JSON.stringify(migrated));
    return migrated;
  } catch (error) {
    return [];
  }
}

function persistWrongBank() {
  localStorage.setItem(WRONG_BANK_KEY, JSON.stringify(state.wrongBank));
}

function updateWrongCount() {
  el.wrongCountText.textContent = String(state.wrongBank.length);
}

function exportWrongBankCsv() {
  if (!state.wrongBank.length) {
    setStatus("错题本为空，无可导出内容。", true);
    return;
  }

  const headers = [
    "source_file",
    "source_label",
    "subject",
    "grade",
    "term",
    "question_type",
    "question",
    "options",
    "correct_answer",
    "last_user_answer",
    "wrong_count",
    "analysis",
    "updated_at",
  ];

  const rows = state.wrongBank.map((item) => {
    const question = state.questionMap.get(item.key);
    const sourceFile = question?.sourceFile || item.sourceFile || "";
    const sourceLabel = question?.sourceLabel || item.sourceLabel || "";
    const subject = question?.subject || item.subject || "";
    const grade = question?.grade || item.grade || "";
    const term = question?.term || item.term || "";
    const questionType = QUESTION_TYPE_LABEL[question?.type || item.type || "unknown"] || "其他题";
    const prompt = question?.question || item.prompt || "";
    const options = (question?.options || [])
      .map((opt) => cleanCell(opt))
      .filter(Boolean)
      .join(" | ");
    const correctAnswer = question?.answerRaw || item.answerRaw || "";
    const analysis = question?.analysis || "";
    const lastUserAnswer = item.lastUserAnswer || "";
    const wrongCount = String(item.wrongCount || 1);
    const updatedAt = item.updatedAt || "";

    return [
      sourceFile,
      sourceLabel,
      subject,
      grade,
      term,
      questionType,
      prompt,
      options,
      correctAnswer,
      lastUserAnswer,
      wrongCount,
      analysis,
      updatedAt,
    ];
  });

  const csvContent = [headers, ...rows]
    .map((row) => row.map(csvEscape).join(","))
    .join("\r\n");

  const now = new Date();
  const stamp = `${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, "0")}${String(
    now.getDate()
  ).padStart(2, "0")}_${String(now.getHours()).padStart(2, "0")}${String(
    now.getMinutes()
  ).padStart(2, "0")}${String(now.getSeconds()).padStart(2, "0")}`;
  const fileName = `错题本导出_${stamp}.csv`;

  downloadTextFile(fileName, "\uFEFF" + csvContent, "text/csv;charset=utf-8;");
  setStatus(`错题导出完成，共 ${rows.length} 题。`);
}

function syncStats() {
  el.totalCount.textContent = String(state.questions.length);

  const done = Math.min(
    state.currentIndex + (state.currentSubmitted ? 1 : 0),
    state.session.length
  );
  el.progressText.textContent = `${done} / ${state.session.length}`;

  const rate = state.answeredCount > 0
    ? ((state.correctCount / state.answeredCount) * 100).toFixed(1)
    : "0.0";
  el.accuracyText.textContent = `${rate}%`;

  const progressPercent = state.session.length
    ? (done / state.session.length) * 100
    : 0;
  el.progressBar.style.width = `${progressPercent.toFixed(2)}%`;
}

function syncPoolPreview() {
  const selectedSources = getSelectedSources();
  const selectedTypes = getSelectedTypes();
  const keywordToken = getKeywordToken();

  const poolCount = state.questions.filter((question) => {
    if (!selectedSources.includes(question.sourceFile)) {
      return false;
    }
    if (!selectedTypes.includes(question.type)) {
      return false;
    }
    if (keywordToken && !questionMatchesKeyword(question, keywordToken)) {
      return false;
    }
    return true;
  }).length;

  if (keywordToken) {
    el.poolHint.textContent = `当前筛选池：${poolCount} 题（关键词：${el.keywordInput.value.trim()}）`;
  } else {
    el.poolHint.textContent = `当前筛选池：${poolCount} 题`;
  }
  el.poolCountText.textContent = String(poolCount);
}

function renderBankSummary() {
  if (!state.questions.length) {
    el.bankSummary.textContent = "暂无可用题库数据。";
    return;
  }

  const countsBySubject = new Map();
  for (const question of state.questions) {
    const subject = question.subject || "其他";
    countsBySubject.set(subject, (countsBySubject.get(subject) || 0) + 1);
  }

  const parts = [];
  for (const [subject, count] of countsBySubject.entries()) {
    parts.push(`${subject} ${count} 题`);
  }

  const modeLabel = state.dataMode === "database" ? "数据库" : state.dataMode === "static" ? "静态" : "当前";
  el.bankSummary.textContent = `已加载 ${state.sources.length} 份${modeLabel}题库，共 ${state.questions.length} 题。${parts.join("，")}。`;
}

function resetPracticeState() {
  state.session = [];
  state.currentIndex = 0;
  state.answeredCount = 0;
  state.correctCount = 0;
  state.currentSubmitted = false;

  el.quizPanel.classList.add("hidden");
  el.summaryPanel.classList.add("hidden");
  setQuizFocusMode(false);
  updateFocusToggleButton();
}

function resetQuestionBank() {
  state.questions = [];
  state.questionMap = new Map();
  state.sources = [];
  state.sourceMetaByFile = new Map();
  state.sourceOrderByFile = new Map();

  rebuildSourceSelector();
  resetPracticeState();
  syncStats();
  syncPoolPreview();
  renderBankSummary();
}

function splitAnswerParts(answer) {
  const normalized = cleanCell(answer);
  if (!normalized) {
    return [];
  }

  return normalized
    .split(/[，,；;、\n]/)
    .map((part) => cleanCell(part))
    .filter(Boolean);
}

function sameText(a, b) {
  const ta = normalizeForCompare(a);
  const tb = normalizeForCompare(b);
  return ta !== "" && ta === tb;
}

function normalizeForCompare(value) {
  return cleanCell(value)
    .toLowerCase()
    .replace(/[。．，,；;、？！!?\s]/g, "");
}

function normalizeChoiceAnswer(answer) {
  const text = cleanCell(answer).toUpperCase();
  const match = text.match(/[ABCD]/);
  return match ? match[0] : "";
}

function normalizeJudgeAnswer(answer) {
  const text = cleanCell(answer);
  if (/正确|对|√|是|true|t|姝ｇ‘|瀵箌/i.test(text)) {
    return "正确";
  }
  if (/错误|错|×|否|false|f|閿欒|閿檤/i.test(text)) {
    return "错误";
  }
  return "";
}

function countQuestionsBySource(questions) {
  const map = new Map();
  for (const question of questions) {
    map.set(question.sourceFile, (map.get(question.sourceFile) || 0) + 1);
  }
  return map;
}

function sortSourceMeta(a, b) {
  const gradeWeight = (grade) => {
    if (grade === "七年级") return 7;
    if (grade === "八年级") return 8;
    return 99;
  };

  const subjectWeight = (subject) => {
    if (subject === "生物") return 1;
    if (subject === "地理") return 2;
    return 9;
  };

  const termWeight = (term) => {
    if (term === "上册") return 1;
    if (term === "下册") return 2;
    return 9;
  };

  const gDiff = gradeWeight(a.grade) - gradeWeight(b.grade);
  if (gDiff !== 0) return gDiff;

  const sDiff = subjectWeight(a.subject) - subjectWeight(b.subject);
  if (sDiff !== 0) return sDiff;

  const tDiff = termWeight(a.term) - termWeight(b.term);
  if (tDiff !== 0) return tDiff;

  return a.displayName.localeCompare(b.displayName, "zh-Hans-CN");
}

function sortQuestion(a, b) {
  if (a.sourceFile !== b.sourceFile) {
    const ia = state.sourceOrderByFile.get(a.sourceFile) ?? 9999;
    const ib = state.sourceOrderByFile.get(b.sourceFile) ?? 9999;
    if (ia !== ib) {
      return ia - ib;
    }
    return a.sourceFile.localeCompare(b.sourceFile, "zh-Hans-CN");
  }

  const na = Number(a.id);
  const nb = Number(b.id);
  if (Number.isFinite(na) && Number.isFinite(nb)) {
    return na - nb;
  }

  return String(a.id).localeCompare(String(b.id), "zh-Hans-CN");
}

function shuffle(items) {
  const arr = items.slice();
  for (let i = arr.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

function normalizeSearchText(value) {
  return cleanCell(value)
    .toLowerCase()
    .replace(/\s+/g, "")
    .replace(/[，,。．；;、！？!?"'“”‘’（）()\[\]【】《》<>]/g, "");
}

function csvEscape(value) {
  const text = String(value ?? "");
  return `"${text.replace(/"/g, '""')}"`;
}

function downloadTextFile(fileName, content, mimeType) {
  const blob = new Blob([content], { type: mimeType });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = fileName;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}

function setQuizFocusMode(enabled) {
  document.body.classList.toggle("quiz-focus-mode", Boolean(enabled));
  updateFocusToggleButton();
}

function isMobileViewport() {
  return window.matchMedia("(max-width: 900px)").matches;
}

function updateFocusToggleButton() {
  const isQuizVisible = !el.quizPanel.classList.contains("hidden");
  const canShow = isQuizVisible && isMobileViewport();
  el.focusToggleBtn.classList.toggle("hidden", !canShow);
  if (!canShow) {
    return;
  }

  const inFocus = document.body.classList.contains("quiz-focus-mode");
  el.focusToggleBtn.textContent = inFocus ? "返回配置" : "专注做题";
}

function toggleFocusModeFromButton() {
  if (!isMobileViewport()) {
    return;
  }

  const inFocus = document.body.classList.contains("quiz-focus-mode");
  if (inFocus) {
    setQuizFocusMode(false);
    const controlsPanel = document.querySelector(".controls-panel");
    if (controlsPanel instanceof HTMLElement) {
      controlsPanel.scrollIntoView({ behavior: "smooth", block: "start" });
    }
    setStatus("已返回配置区，可调整筛选后继续作答。");
    return;
  }

  setQuizFocusMode(true);
  el.quizPanel.scrollIntoView({ behavior: "smooth", block: "start" });
  setStatus("已切换到专注做题模式。");
}

function renderMarkdown(text) {
  const raw = cleanCell(text);
  if (!raw) {
    return "<p>无</p>";
  }

  const blocks = raw
    .replace(/\r\n/g, "\n")
    .split(/\n{2,}/)
    .map((block) => block.trim())
    .filter(Boolean);

  if (!blocks.length) {
    return "<p>无</p>";
  }

  return blocks.map((block) => renderMarkdownBlock(block)).join("");
}

function renderMarkdownBlock(block) {
  const lines = block.split("\n").map((line) => line.trimEnd());
  if (!lines.length) {
    return "";
  }

  if (isMarkdownTable(lines)) {
    return renderMarkdownTable(lines);
  }

  if (lines.every((line) => /^\s*[-*+]\s+/.test(line))) {
    const items = lines.map((line) => line.replace(/^\s*[-*+]\s+/, "").trim());
    return `<ul>${items.map((item) => `<li>${renderInlineMarkdown(item)}</li>`).join("")}</ul>`;
  }

  if (lines.every((line) => /^\s*\d+\.\s+/.test(line))) {
    const items = lines.map((line) => line.replace(/^\s*\d+\.\s+/, "").trim());
    return `<ol>${items.map((item) => `<li>${renderInlineMarkdown(item)}</li>`).join("")}</ol>`;
  }

  if (lines.length === 1 && /^\s*#{1,6}\s+/.test(lines[0])) {
    const level = Math.min((lines[0].match(/^(\s*#+)/)?.[0].trim().length || 1), 6);
    const title = lines[0].replace(/^\s*#{1,6}\s+/, "");
    return `<h${level}>${renderInlineMarkdown(title)}</h${level}>`;
  }

  const paragraph = renderInlineMarkdown(lines.join("\n")).replace(/\n/g, "<br>");
  return `<p>${paragraph}</p>`;
}

function isMarkdownTable(lines) {
  if (lines.length < 2) {
    return false;
  }
  if (!lines[0].includes("|")) {
    return false;
  }
  const separator = lines[1].trim();
  return /^\|?\s*:?-{3,}:?\s*(\|\s*:?-{3,}:?\s*)+\|?$/.test(separator);
}

function parseTableRow(line) {
  let trimmed = line.trim();
  if (trimmed.startsWith("|")) {
    trimmed = trimmed.slice(1);
  }
  if (trimmed.endsWith("|")) {
    trimmed = trimmed.slice(0, -1);
  }
  return trimmed.split("|").map((cell) => cell.trim());
}

function parseAlignments(separatorLine) {
  return parseTableRow(separatorLine).map((token) => {
    const t = token.trim();
    if (t.startsWith(":") && t.endsWith(":")) {
      return "center";
    }
    if (t.endsWith(":")) {
      return "right";
    }
    return "left";
  });
}

function renderMarkdownTable(lines) {
  const headerCells = parseTableRow(lines[0]);
  const alignments = parseAlignments(lines[1]);
  const bodyRows = lines
    .slice(2)
    .filter((line) => line.includes("|"))
    .map((line) => parseTableRow(line));

  const headHtml = headerCells
    .map((cell, idx) => `<th class="md-align-${alignments[idx] || "left"}">${renderInlineMarkdown(cell)}</th>`)
    .join("");

  const bodyHtml = bodyRows
    .map((row) => {
      const filled = row.slice(0, headerCells.length);
      while (filled.length < headerCells.length) {
        filled.push("");
      }
      const cells = filled
        .map(
          (cell, idx) =>
            `<td class="md-align-${alignments[idx] || "left"}">${renderInlineMarkdown(cell)}</td>`
        )
        .join("");
      return `<tr>${cells}</tr>`;
    })
    .join("");

  return `
    <div class="md-table-wrap">
      <table class="md-table">
        <thead><tr>${headHtml}</tr></thead>
        <tbody>${bodyHtml}</tbody>
      </table>
    </div>
  `;
}

function renderInlineMarkdown(text) {
  let html = escapeHtml(text);
  html = html.replace(/`([^`]+?)`/g, "<code>$1</code>");
  html = html.replace(/\*\*([^*]+?)\*\*/g, "<strong>$1</strong>");
  html = html.replace(/\*([^*]+?)\*/g, "<em>$1</em>");
  return html;
}

function setStatus(message, isError = false) {
  el.statusMessage.textContent = message;
  el.statusMessage.style.color = isError ? "#9b2226" : "#4f4a42";
}

function escapeHtml(value) {
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function escapeAttribute(value) {
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/"/g, "&quot;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

