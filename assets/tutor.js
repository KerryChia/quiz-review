/* AI 助教 · 纯前端直连 OpenAI 兼容接口
   配置只写入本浏览器 localStorage，不经过任何第三方服务器。 */
(function () {
  'use strict';

  var CFG_KEY = 'quiz-ai-config-v1';
  var SKIP_KEY = 'quiz-ai-setup-skipped-v1';
  var DEFAULT_BASE = 'https://api.deepseek.com';
  var DEFAULT_MODEL = 'deepseek-flash';
  var COURSE = (window.QUIZ_AI && window.QUIZ_AI.course) || '本课程';
  var aiCfg = { baseUrl: DEFAULT_BASE, apiKey: '', model: DEFAULT_MODEL };

  try {
    var savedCfg = JSON.parse(localStorage.getItem(CFG_KEY) || '{}');
    if (savedCfg.baseUrl) aiCfg.baseUrl = savedCfg.baseUrl;
    if (savedCfg.apiKey) aiCfg.apiKey = savedCfg.apiKey;
    if (savedCfg.model) aiCfg.model = savedCfg.model;
  } catch (e) {}

  function persistCfg() {
    try { localStorage.setItem(CFG_KEY, JSON.stringify(aiCfg)); } catch (e) {}
  }

  var toastTimer = null;
  function toast(msg, ms) {
    var el = document.getElementById('ai-toast');
    if (!el) {
      el = document.createElement('div');
      el.id = 'ai-toast';
      el.style.cssText = 'position:fixed;left:50%;bottom:104px;transform:translateX(-50%);z-index:95;pointer-events:none;' +
        'background:rgba(36,31,30,.92);color:#fff;font-size:13px;padding:10px 16px;border-radius:10px;' +
        'max-width:min(90vw,480px);line-height:1.6;box-shadow:0 8px 24px rgba(0,0,0,.2);transition:opacity .25s';
      document.body.appendChild(el);
    }
    el.textContent = msg;
    el.style.display = 'block';
    el.style.opacity = '1';
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () {
      el.style.opacity = '0';
      setTimeout(function () { el.style.display = 'none'; }, 260);
    }, ms || 2600);
  }

  /* ---------- 接口地址与请求 ---------- */
  function apiUrl(base) {
    var b = String(base || DEFAULT_BASE).trim().replace(/\/+$/, '');
    if (/\/chat\/completions$/.test(b)) return b;
    if (/\/v1$/.test(b)) return b + '/chat/completions';
    return b + '/v1/chat/completions';
  }

  function httpError(status, text) {
    var msg = '';
    try {
      var o = JSON.parse(text);
      msg = (o.error && (o.error.message || o.error)) || o.message || '';
    } catch (e) {
      msg = String(text || '').slice(0, 160);
    }
    return 'HTTP ' + status + (msg ? '：' + msg : '');
  }

  function chat(messages, opts) {
    opts = opts || {};
    var body = {
      model: aiCfg.model || DEFAULT_MODEL,
      messages: messages,
      temperature: opts.temperature === undefined ? 0.3 : opts.temperature,
      max_tokens: opts.max_tokens || 2000,
      stream: !!opts.onDelta
    };
    return fetch(apiUrl(aiCfg.baseUrl), {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': 'Bearer ' + aiCfg.apiKey
      },
      body: JSON.stringify(body)
    }).then(function (res) {
      if (!res.ok) {
        return res.text().then(function (t) { throw new Error(httpError(res.status, t)); });
      }
      if (!opts.onDelta || !res.body || !res.body.getReader) {
        return res.json().then(function (data) {
          var m = (data.choices && data.choices[0] && data.choices[0].message) || {};
          return { text: m.content || '', reasoning: m.reasoning_content || '' };
        });
      }
      var acc = { text: '', reasoning: '' };
      var reader = res.body.getReader();
      var dec = new TextDecoder('utf-8');
      var buf = '';
      function pump() {
        return reader.read().then(function (r) {
          if (r.done) return;
          buf += dec.decode(r.value, { stream: true });
          var idx;
          while ((idx = buf.indexOf('\n')) >= 0) {
            var line = buf.slice(0, idx).trim();
            buf = buf.slice(idx + 1);
            if (line.indexOf('data:') !== 0) continue;
            var payload = line.slice(5).trim();
            if (!payload || payload === '[DONE]') continue;
            var obj;
            try { obj = JSON.parse(payload); } catch (e) { continue; }
            var d = (obj.choices && obj.choices[0] && obj.choices[0].delta) || {};
            if (d.reasoning_content) {
              acc.reasoning += d.reasoning_content;
              opts.onDelta('reasoning', d.reasoning_content);
            }
            if (d.content) {
              acc.text += d.content;
              opts.onDelta('content', d.content);
            }
          }
          return pump();
        });
      }
      return pump().then(function () { return acc; });
    }).catch(function (e) {
      if (e && e.name === 'TypeError') {
        throw new Error('连不上这个地址。检查 Base URL 是否写对、网络是否可用；若服务商不允许浏览器直连，会报 CORS 错误。');
      }
      throw e;
    });
  }

  function extractJson(text) {
    var start = text.indexOf('{');
    if (start < 0) throw new Error('模型没有返回 JSON');
    var depth = 0;
    for (var i = start; i < text.length; i++) {
      if (text[i] === '{') depth++;
      else if (text[i] === '}') {
        depth--;
        if (depth === 0) return JSON.parse(text.slice(start, i + 1));
      }
    }
    throw new Error('模型返回的 JSON 不完整');
  }

  /* ---------- 设置弹窗 ---------- */
  function buildSetup() {
    if (document.getElementById('ai-setup')) return;
    var box = document.createElement('div');
    box.id = 'ai-setup';
    box.innerHTML =
      '<div class="ai-modal-box" role="dialog" aria-modal="true" aria-labelledby="ai-setup-title">' +
      '<h3 id="ai-setup-title">启用 AI 助教</h3>' +
      '<p>填入你自己的 API Key。Key 只保存在本浏览器，请求直接发给你填的服务商，不经过任何中转。</p>' +
      '<label class="ai-field">Base URL<input id="ai-cfg-base" type="text" spellcheck="false" placeholder="' + DEFAULT_BASE + '"></label>' +
      '<label class="ai-field">API Key<input id="ai-cfg-key" type="password" spellcheck="false" placeholder="sk-..."></label>' +
      '<details><summary>高级：模型名</summary>' +
      '<label class="ai-field"><input id="ai-cfg-model" type="text" spellcheck="false" placeholder="' + DEFAULT_MODEL + '"></label>' +
      '</details>' +
      '<p class="ai-err" id="ai-cfg-err"></p>' +
      '<div class="ai-modal-actions">' +
      '<button class="btn ghost" type="button" id="ai-cfg-cancel">稍后再说</button>' +
      '<button class="btn" type="button" id="ai-cfg-save">保存并启用</button>' +
      '</div>' +
      '<p class="ai-modal-hint">还没有 Key？<a href="https://platform.deepseek.com/" target="_blank" rel="noopener">去 DeepSeek 开放平台获取</a>，充值少量金额即可使用；填好后把 Base URL 保持默认即可。</p>' +
      '</div>';
    document.body.appendChild(box);

    box.addEventListener('click', function (e) { if (e.target === box) closeSetup(true); });
    document.getElementById('ai-cfg-cancel').addEventListener('click', function () { closeSetup(true); });
    document.getElementById('ai-cfg-save').addEventListener('click', saveSetup);
    document.getElementById('ai-cfg-key').addEventListener('keydown', function (e) {
      if (e.key === 'Enter') saveSetup();
    });
  }

  function openSetup() {
    buildSetup();
    document.getElementById('ai-cfg-base').value = aiCfg.baseUrl || DEFAULT_BASE;
    document.getElementById('ai-cfg-key').value = aiCfg.apiKey || '';
    document.getElementById('ai-cfg-model').value = aiCfg.model || DEFAULT_MODEL;
    var err = document.getElementById('ai-cfg-err');
    err.style.display = 'none';
    document.getElementById('ai-setup').classList.add('open');
    setTimeout(function () { document.getElementById('ai-cfg-key').focus(); }, 60);
  }

  function closeSetup(skipped) {
    var el = document.getElementById('ai-setup');
    if (el) el.classList.remove('open');
    if (skipped) {
      try { localStorage.setItem(SKIP_KEY, '1'); } catch (e) {}
    }
  }

  function saveSetup() {
    var base = document.getElementById('ai-cfg-base').value.trim() || DEFAULT_BASE;
    var key = document.getElementById('ai-cfg-key').value.trim();
    var model = document.getElementById('ai-cfg-model').value.trim() || DEFAULT_MODEL;
    if (!key) {
      var err = document.getElementById('ai-cfg-err');
      err.textContent = '请填 API Key。';
      err.style.display = 'block';
      return;
    }
    aiCfg.baseUrl = base;
    aiCfg.apiKey = key;
    aiCfg.model = model;
    persistCfg();
    closeSetup(false);
    syncModelSelect();
    updateFab();
    toast('AI 助教已启用');
    if (panel && panel.classList.contains('open') && !msgs.length) greet();
  }

  function updateFab() {
    var fab = document.getElementById('ai-fab');
    if (fab) fab.classList.toggle('off', !aiCfg.apiKey);
  }

  function ensureCfg() {
    if (aiCfg.apiKey) return true;
    openSetup();
    toast('先填入 API Key 才能使用 AI 助教');
    return false;
  }

  /* ---------- 主观题：作答框与 AI 判卷 ---------- */
  function afterRender() {
    var q = byId.get(state.current);
    if (!q || q.type !== 'subjective') return;
    var card = document.getElementById('question-card');
    if (!card) return;
    var actions = card.querySelector('.actions');
    if (actions && !card.querySelector('[data-sol]')) {
      var r = rec(q.id);
      var box = document.createElement('div');
      box.className = 'solinput';
      box.innerHTML = '<label>我的作答 <span>（写完可让 AI 按评分点判卷）</span></label>' +
        '<textarea data-sol rows="4" placeholder="写清思路、公式、代入与结论"></textarea>';
      card.insertBefore(box, actions);
      var ta = box.querySelector('textarea');
      ta.value = r.sol || '';
      ta.addEventListener('input', function () { r.sol = ta.value; save(); });

      var gbtn = document.createElement('button');
      gbtn.className = 'btn ghost';
      gbtn.type = 'button';
      gbtn.setAttribute('data-aigrade', '1');
      gbtn.textContent = 'AI 判卷';
      gbtn.addEventListener('click', function (e) { e.preventDefault(); doGrade(); });
      actions.appendChild(gbtn);
    }
    var grade = rec(q.id).aiGrade;
    if (grade && !document.getElementById('aigrade-box')) {
      var sol = document.getElementById('solution');
      if (sol) {
        var div = document.createElement('div');
        div.className = 'aigrade';
        div.id = 'aigrade-box';
        div.innerHTML = '<div class="hd"><b>AI 判卷</b><span class="sc">' + esc(grade.score) + ' / ' + esc(grade.max) +
          '</span><span class="mdl">' + esc(grade.model || '') + '</span></div><p>' + esc(grade.comment || '') + '</p>';
        sol.parentNode.insertBefore(div, sol);
      }
    }
  }

  var GRADE_SYS = '你是《' + COURSE + '》的助教，给简答与计算题判卷。你会得到题目、参考答案（含评分点）与学生作答。' +
    '按评分点给分：关键步骤（列公式、代入、化简、结论）到位才给分；只写答案没有过程最多给一半分；' +
    '思路正确但符号或计算小错扣 1~2 分，不判全错；空白或完全跑题给 0 分。' +
    '满分取题目给出的分值，未给出按 10 分。只输出一个 JSON 对象，不要输出其他文字：' +
    '{"score": <整数>, "max": <整数>, "comment": "<2~3 句中文点评：先肯定做对的，再指出漏了或错了什么>"}';

  function doGrade() {
    var q = byId.get(state.current);
    if (!q) return;
    var r = rec(q.id);
    var ans = (r.sol || '').trim();
    if (!ans) { toast('先写下作答，再让 AI 判卷'); return; }
    if (!ensureCfg()) return;
    var btn = document.querySelector('[data-aigrade]');
    if (btn) { btn.disabled = true; btn.textContent = '判卷中…'; }
    var userMsg = '【题目】\n' + q.stem +
      (q.points ? '\n（本题 ' + q.points + ' 分）' : '') +
      '\n\n【参考答案与评分点】\n' + (q.solution || '') +
      '\n\n【学生作答】\n' + ans + '\n\n只输出 JSON。';
    chat([{ role: 'system', content: GRADE_SYS }, { role: 'user', content: userMsg }],
      { temperature: 0.1, max_tokens: 900 })
      .then(function (out) {
        var obj = extractJson(out.text);
        var max = Math.max(1, Math.round(Number(obj.max) || Number(q.points) || 10));
        var score = Math.max(0, Math.min(max, Math.round(Number(obj.score) || 0)));
        r.aiGrade = { score: score, max: max, comment: String(obj.comment || ''), model: aiCfg.model };
        r.revealed = true;
        save(); render();
        toast('AI 判卷完成：' + score + ' / ' + max);
      })
      .catch(function (e) {
        toast('判卷失败：' + e.message, 4200);
        if (btn) { btn.disabled = false; btn.textContent = 'AI 判卷'; }
      });
  }

  /* ---------- 面板 ---------- */
  var panel = null;
  var msgs = [];
  var streaming = false;

  function buildPanel() {
    if (document.getElementById('ai-panel')) return;
    var fab = document.createElement('button');
    fab.id = 'ai-fab';
    fab.type = 'button';
    fab.title = 'AI 助教';
    fab.innerHTML = '<span class="dot"></span>AI 助教';
    document.body.appendChild(fab);
    updateFab();

    panel = document.createElement('aside');
    panel.id = 'ai-panel';
    panel.innerHTML =
      '<header><strong>AI 助教</strong>' +
      '<select id="ai-model" aria-label="选择模型"></select>' +
      '<button id="ai-gear" type="button" title="API 设置">⚙</button>' +
      '<button id="ai-close" type="button" aria-label="关闭">×</button></header>' +
      '<div id="ai-msgs"></div>' +
      '<div class="ai-quick">' +
      '<button type="button" data-q="这题的解题思路是什么？先别直接给答案">思路</button>' +
      '<button type="button" data-q="这道题最容易错在哪一步？">易错点</button>' +
      '<button type="button" data-q="用更基础的方式再讲一遍。">讲慢点</button>' +
      '<button type="button" data-q="给我一道同类型的新题，先不要给答案，等我做完再批改。">同类题</button>' +
      '</div>' +
      '<div class="ai-inputrow"><textarea id="ai-input" rows="1" placeholder="问 AI 助教…（Enter 发送）"></textarea>' +
      '<button class="btn" id="ai-send" type="button">发送</button></div>';
    document.body.appendChild(panel);

    fab.addEventListener('click', function () {
      if (!aiCfg.apiKey) { openSetup(); return; }
      panel.classList.toggle('open');
      if (panel.classList.contains('open')) {
        if (!msgs.length) greet();
        document.getElementById('ai-input').focus();
      }
    });
    document.getElementById('ai-close').addEventListener('click', function () { panel.classList.remove('open'); });
    document.getElementById('ai-gear').addEventListener('click', openSetup);
    document.getElementById('ai-model').addEventListener('change', function (e) {
      aiCfg.model = e.target.value;
      persistCfg();
      toast('已切换模型：' + aiCfg.model);
    });
    document.getElementById('ai-send').addEventListener('click', sendAsk);
    document.getElementById('ai-input').addEventListener('keydown', function (e) {
      if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendAsk(); }
    });
    panel.querySelectorAll('.ai-quick button').forEach(function (b) {
      b.addEventListener('click', function () {
        if (!ensureCfg()) return;
        document.getElementById('ai-input').value = b.dataset.q;
        sendAsk();
      });
    });
    document.addEventListener('keydown', function (e) {
      if (e.key === 'Escape') panel.classList.remove('open');
    });
    syncModelSelect();
  }

  function syncModelSelect() {
    var sel = document.getElementById('ai-model');
    if (!sel) return;
    var list = ['deepseek-flash', 'deepseek-chat', 'deepseek-reasoner'];
    if (list.indexOf(aiCfg.model) < 0) list.unshift(aiCfg.model);
    sel.innerHTML = list.map(function (m) {
      return '<option value="' + esc(m) + '"' + (m === aiCfg.model ? ' selected' : '') + '>' + esc(m) + '</option>';
    }).join('');
  }

  function greet() {
    var q = byId.get(state.current);
    msgs.push({
      role: 'assistant',
      text: '我是这门课的 AI 助教。当前题目 **' + (q ? q.id : '—') + '**，可以问思路、易错点，也可以让我给主观题判卷。'
    });
    paint();
  }

  function paint() {
    var box = document.getElementById('ai-msgs');
    if (!box) return;
    box.innerHTML = '';
    msgs.forEach(function (m) {
      var d = document.createElement('div');
      if (m.role === 'user') {
        d.className = 'ai-msg user';
        d.textContent = m.text;
      } else {
        d.className = 'ai-msg bot' + (m.err ? ' err' : '');
        var html = '';
        if (m.reasoning) html += '<div class="ai-reasoning">' + esc(m.reasoning) + '</div>';
        html += (m.text ? rich(m.text) : '<span style="color:var(--muted)">正在思考…</span>');
        d.innerHTML = html;
      }
      box.appendChild(d);
    });
    box.scrollTop = box.scrollHeight;
  }

  function ctxOf() {
    var q = byId.get(state.current);
    if (!q) return {};
    var r = rec(q.id);
    var opts = (q.options || []).map(function (o) { return o[0] + '. ' + o[1]; }).join('\n');
    var mine = (q.type === 'choice' || q.type === 'judge') ? (r.picked || '') :
      q.type === 'fill' ? ((r.draft || []).join(' | ')) : (r.sol || '');
    var notesEl = document.querySelector('.notes-body');
    return {
      qid: q.id, stem: q.stem, options: opts,
      notes: notesEl ? notesEl.innerText.slice(0, 1500) : '',
      myAnswer: mine, explanation: q.solution || ''
    };
  }

  var ASK_SYS = '你是《' + COURSE + '》的 AI 助教，面向正在复习备考的学生。' +
    '先给结论，再给推导；推导要写清每一步依据（用了哪条定义、公式或定理）；' +
    '涉及计算时列出中间结果，不要跳步；学生答错时先指出错在哪一步、为什么会错，再给正确做法。' +
    '公式行内用 $...$，独立成行用 $$...$$，可用 \\frac \\sqrt \\int \\sum \\lim 等；不要用 Markdown 表格。' +
    '不要寒暄，不要复述题目。';

  function sendAsk() {
    if (streaming) return;
    if (!ensureCfg()) return;
    var input = document.getElementById('ai-input');
    var text = (input.value || '').trim();
    if (!text) return;
    input.value = '';
    msgs.push({ role: 'user', text: text });
    var bot = { role: 'assistant', text: '', reasoning: '' };
    msgs.push(bot);
    paint();
    streaming = true;
    var sendBtn = document.getElementById('ai-send');
    sendBtn.disabled = true;

    var ctx = ctxOf();
    var parts = [];
    if (ctx.qid) parts.push('【当前题目编号】' + ctx.qid);
    if (ctx.stem) parts.push('【题目原文】\n' + ctx.stem);
    if (ctx.options) parts.push('【选项】\n' + ctx.options);
    if (ctx.notes) parts.push('【本板块知识点】\n' + ctx.notes);
    if (ctx.myAnswer) parts.push('【我的作答】\n' + ctx.myAnswer);
    if (ctx.explanation) parts.push('【参考答案（讲解时先引导思路，再给答案）】\n' + ctx.explanation);

    var messages = [{ role: 'system', content: ASK_SYS }];
    if (parts.length) {
      messages.push({ role: 'user', content: '【本题背景】\n' + parts.join('\n\n') });
      messages.push({ role: 'assistant', content: '好，我已读完这道题。' });
    }
    msgs.slice(0, -2).slice(-8).forEach(function (m) {
      if (m.text) messages.push({ role: m.role, content: m.text });
    });
    messages.push({ role: 'user', content: text });

    var lastPaint = 0;
    chat(messages, {
      temperature: 0.4,
      max_tokens: 2600,
      onDelta: function (kind, piece) {
        if (kind === 'content') bot.text += piece;
        else bot.reasoning += piece;
        var now = Date.now();
        if (now - lastPaint > 90) { lastPaint = now; paint(); }
      }
    }).then(function () {
      streaming = false;
      sendBtn.disabled = false;
      if (!bot.text) bot.text = '（没有返回内容，请重试）';
      paint();
    }).catch(function (e) {
      streaming = false;
      sendBtn.disabled = false;
      bot.err = true;
      bot.text = (bot.text ? bot.text + '\n\n' : '') + '出错了：' + e.message;
      paint();
    });
  }

  /* ---------- 启动 ---------- */
  var _render = render;
  render = function () { _render(); afterRender(); };

  document.documentElement.classList.add('has-ai');
  buildPanel();
  afterRender();

  if (!aiCfg.apiKey) {
    var skipped = false;
    try { skipped = !!localStorage.getItem(SKIP_KEY); } catch (e) {}
    if (!skipped) setTimeout(openSetup, 700);
  }
})();
