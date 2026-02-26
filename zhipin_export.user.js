// ==UserScript==
// @name         Boss直聘 岗位导出（收藏/搜索）
// @namespace    https://github.com/
// @version      5.2
// @description  导出 Boss直聘 收藏或搜索结果岗位详情为 JSON + Excel，支持中断续抓
// @match        https://www.zhipin.com/*
// @grant        none
// @run-at       document-start
// @require      https://cdnjs.cloudflare.com/ajax/libs/xlsx/0.18.5/xlsx.full.min.js
// ==/UserScript==

(function () {
  'use strict';

  // ── XHR / Fetch 拦截（document-start 最早执行）──────────
  // Boss直聘详情数据从 /wapi/zpgeek/job/detail.json 的 XHR 响应获取
  ;(function interceptJobDetail() {
    const DETAIL_PATH = '/wapi/zpgeek/job/detail.json';

    function handleResponse(text) {
      try {
        const jobInfo = JSON.parse(text)?.zpData?.jobInfo;
        if (jobInfo && jobInfo.jobName) {
          window.__ZE_JOB_INFO__ = jobInfo;
          document.dispatchEvent(new CustomEvent('ze:jobInfo', { detail: jobInfo }));
        }
      } catch (_) {}
    }

    const _open = XMLHttpRequest.prototype.open;
    const _send = XMLHttpRequest.prototype.send;
    XMLHttpRequest.prototype.open = function (method, url) {
      this._ze_url = typeof url === 'string' ? url : String(url);
      return _open.apply(this, arguments);
    };
    XMLHttpRequest.prototype.send = function () {
      if (this._ze_url && this._ze_url.includes(DETAIL_PATH)) {
        this.addEventListener('load', function () { handleResponse(this.responseText); });
      }
      return _send.apply(this, arguments);
    };

    const _fetch = window.fetch;
    window.fetch = function (input) {
      const url = typeof input === 'string' ? input : (input && input.url) || '';
      const p = _fetch.apply(this, arguments);
      if (url.includes(DETAIL_PATH)) {
        p.then(r => r.clone().text().then(handleResponse)).catch(() => {});
      }
      return p;
    };
  })();

  // ── DOM 就绪后执行主逻辑 ─────────────────────────────────
  function domReady(fn) {
    if (document.readyState !== 'loading') fn();
    else document.addEventListener('DOMContentLoaded', fn);
  }

  const sleep = ms => new Promise(r => setTimeout(r, ms));
  const jitter = () => Math.random() * 800 + 400;

  // ── 页面路由检测 ─────────────────────────────────────────
  const isDetailPage    = () => /\/job_detail\//.test(location.pathname);
  const isFavoritesPage = () => /\/web\/geek\/recommend/.test(location.href);
  // 搜索/推荐浏览页：/web/geek/job  /web/geek/job-recommend  /web/geek/jobs 等
  const isSearchPage    = () => /\/web\/geek\/job/.test(location.pathname) && !isFavoritesPage();

  // ── IndexedDB 辅助层 ─────────────────────────────────────
  const DB_NAME  = 'zhipin_export_v5';
  const DB_STORE = 'session';
  const DB_KEY   = 'main';

  function openDB() {
    return new Promise((resolve, reject) => {
      const req = indexedDB.open(DB_NAME, 1);
      req.onupgradeneeded = e => e.target.result.createObjectStore(DB_STORE);
      req.onsuccess  = e => resolve(e.target.result);
      req.onerror    = e => reject(e.target.error);
    });
  }
  async function dbGet() {
    const db = await openDB();
    return new Promise((resolve, reject) => {
      const tx  = db.transaction(DB_STORE, 'readonly');
      const req = tx.objectStore(DB_STORE).get(DB_KEY);
      req.onsuccess = e => resolve(e.target.result ?? null);
      req.onerror   = e => reject(e.target.error);
    });
  }
  async function dbSet(value) {
    const db = await openDB();
    return new Promise((resolve, reject) => {
      const tx  = db.transaction(DB_STORE, 'readwrite');
      const req = tx.objectStore(DB_STORE).put(value, DB_KEY);
      req.onsuccess = () => resolve();
      req.onerror   = e => reject(e.target.error);
    });
  }
  async function dbDel() {
    const db = await openDB();
    return new Promise((resolve, reject) => {
      const tx  = db.transaction(DB_STORE, 'readwrite');
      const req = tx.objectStore(DB_STORE).delete(DB_KEY);
      req.onsuccess = () => resolve();
      req.onerror   = e => reject(e.target.error);
    });
  }

  // ── 翻页工具 ─────────────────────────────────────────────
  // Boss直聘翻页结构：<li class="disabled"><span class="ui-icon-arrow-right"></span></li>
  // disabled 在父 <li>，不在 icon 自身
  function getNextBtn() {
    const icon = document.querySelector('.ui-icon-arrow-right');
    if (!icon) return null;
    const parent = icon.closest('li') || icon.parentElement;
    if (!parent) return null;
    if (parent.classList.contains('disabled') || parent.disabled) return null;
    return parent;
  }

  function clickNextAndWait(prevSecIds) {
    return new Promise((resolve) => {
      const btn = getNextBtn();
      if (!btn) return resolve(false);

      const timer = setTimeout(() => { observer.disconnect(); resolve(false); }, 12000);

      const observer = new MutationObserver(() => {
        const anyNew = [...document.querySelectorAll('a[href*="/job_detail/"]')].some(a => {
          const sid = (a.href || '').match(/[?&]securityId=([^&]+)/)?.[1];
          return sid && !prevSecIds.has(sid);
        });
        if (anyNew) {
          clearTimeout(timer);
          observer.disconnect();
          resolve(true);
        }
      });

      observer.observe(document.body, { childList: true, subtree: true });
      btn.click();
    });
  }

  // ── 收集岗位（列表页通用） ───────────────────────────────
  function collectJobsFromPage(seen) {
    const jobs = [];
    const txt = (card, sels) => {
      for (const s of sels) {
        const v = card.querySelector(s)?.textContent?.trim();
        if (v) return v;
      }
      return '';
    };

    document.querySelectorAll('a[href*="/job_detail/"]').forEach(a => {
      const href  = a.href || '';
      const secId = href.match(/[?&]securityId=([^&]+)/)?.[1] || '';
      const encId = href.match(/\/job_detail\/([^.?]+)/)?.[1]  || '';
      // secId 优先，没有则用 encId 去重（搜索页卡片链接可能不含 securityId）
      const uid = secId || encId;
      if (!uid || seen.has(uid)) return;
      seen.add(uid);

      // 兼容收藏页(.card-area)和搜索页(.job-card-wrapper/.job-card-body)
      const card = a.closest('.card-area')
                || a.closest('.job-card-wrapper')
                || a.closest('.job-card-body')
                || a.closest('[class*="job-card"]')
                || a.parentElement;
      jobs.push({
        securityId:   secId,
        encryptJobId: encId,
        jobUrl:       secId ? (href.split('?')[0] + '?securityId=' + secId) : href,
        status:       'pending',
        data: {
          岗位名称: txt(card, ['.job-name', '.job-title-text', '[class*="job-name"]']),
          公司名称: txt(card, ['.company-name', '.brand-name', '[class*="company-name"]']),
          薪资:     txt(card, ['.salary', '.job-salary', '[class*="salary"]']),
          区域:     txt(card, ['.job-area', '.job-location', '[class*="area-district"]']),
        },
      });
    });

    return jobs;
  }

  async function collectAllJobs(onProgress) {
    const allJobs = [];
    const seen    = new Set();
    let page = 1;

    while (true) {
      const pageJobs = collectJobsFromPage(seen);
      allJobs.push(...pageJobs);
      onProgress(`扫描第 ${page} 页，已收集 ${allJobs.length} 个岗位`, allJobs.length, 0);

      if (!getNextBtn()) break;

      const ok = await clickNextAndWait(seen);
      if (!ok) break;

      page++;
      await sleep(800 + jitter());
    }

    return allJobs;
  }

  // ── 详情页数据 ───────────────────────────────────────────
  function waitForJobInfo(timeoutMs = 10000) {
    return new Promise(resolve => {
      if (window.__ZE_JOB_INFO__) return resolve(window.__ZE_JOB_INFO__);

      const timer = setTimeout(() => {
        document.removeEventListener('ze:jobInfo', handler);
        resolve(null);
      }, timeoutMs);

      function handler(e) {
        clearTimeout(timer);
        document.removeEventListener('ze:jobInfo', handler);
        resolve(e.detail);
      }
      document.addEventListener('ze:jobInfo', handler);
    });
  }

  function buildDataFromJobInfo(j) {
    const desc = (j.postDescription || '')
      .split('\n').map(s => s.trim()).filter(Boolean).join('\n');
    return {
      岗位名称: j.jobName              || '',
      公司名称: j.brandName            || '',
      薪资:     j.salaryDesc           || '',
      城市:     j.cityName             || '',
      区域:     j.areaDistrict         || '',
      经验要求: j.yearsOfExperience    || j.jobExperience    || '',
      学历要求: j.degreeName           || j.jobDegree        || '',
      公司阶段: j.financingStage       || j.brandStageName   || '',
      公司规模: j.scaleName            || j.brandScaleName   || '',
      行业:     j.industryName         || j.brandIndustry    || '',
      技能标签: Array.isArray(j.skills)      ? j.skills.join('、')      : '',
      福利待遇: Array.isArray(j.welfareList) ? j.welfareList.join('、') : '',
      详细地址: j.addressDefault       || j.address          || '',
      岗位状态: j.jobStatusDesc        || '',
      HR活跃:   j.bossLatestOnlineTime || j.activeTimeDesc   || '',
      HR姓名:   j.bossName             || '',
      HR职位:   j.bossTitle            || '',
      岗位描述: desc,
    };
  }

  function extractFromDOM() {
    const t = (sels) => {
      for (const s of sels) {
        const v = document.querySelector(s)?.textContent?.trim();
        if (v) return v;
      }
      return '';
    };

    const skills = [...document.querySelectorAll(
      '.job-tags .tag-item, [class*="job-tag"] span, [class*="tag-list"] span'
    )].map(el => el.textContent.trim()).filter(Boolean).join('、');

    const welfare = [...document.querySelectorAll(
      '[class*="welfare"] span, [class*="welfare-item"]'
    )].map(el => el.textContent.trim()).filter(Boolean).join('、');

    const desc = [...document.querySelectorAll(
      '.job-sec-text, .job-detail .text, [class*="job-sec"] .text'
    )].map(el => el.textContent.trim()).filter(Boolean).join('\n\n');

    return {
      岗位名称: t(['.job-title .name', 'h1.name', '[class*="job-name"] h1']),
      公司名称: t(['.company-info .name', '.brand-name', '[class*="company-name"] a']),
      薪资:     t(['.salary', '.job-salary', '[class*="salary"]']),
      城市:     t(['.job-area', '[class*="city-name"]']),
      区域:     t(['.job-area em', '[class*="area-district"]']),
      经验要求: t(['[class*="job-experience"]', '[class*="experience"]']),
      学历要求: t(['[class*="job-degree"]', '[class*="degree"]']),
      公司阶段: t(['[class*="financing-stage"]', '[class*="brand-stage"]']),
      公司规模: t(['[class*="scale-name"]', '[class*="brand-scale"]']),
      行业:     t(['[class*="industry-name"]', '[class*="brand-industry"]']),
      技能标签: skills,
      福利待遇: welfare,
      详细地址: t(['[class*="address"]', '.job-address']),
      岗位状态: t(['[class*="job-status"]', '[class*="status-desc"]']),
      HR活跃:   t(['[class*="active-time"]', '[class*="last-active"]']),
      HR姓名:   t(['.recruiter-info .name', '[class*="recruiter"] .name']),
      HR职位:   t(['.recruiter-info .title', '[class*="recruiter"] .title']),
      岗位描述: desc,
    };
  }

  // ── 导出工具 ─────────────────────────────────────────────
  function dl(blob, name) {
    const a = Object.assign(document.createElement('a'),
      { href: URL.createObjectURL(blob), download: name });
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 5000);
  }
  const ts = () => new Date().toISOString().slice(0, 16).replace(/[^0-9]/g, '_');

  function exportFiles(jobs, sheetLabel = '岗位列表') {
    const rows = jobs.map(j => ({ ...j.data, 岗位链接: j.jobUrl }));

    dl(
      new Blob([JSON.stringify(rows.map(({ 岗位描述: _, ...r }) => r), null, 2)],
        { type: 'application/json' }),
      `zhipin_${ts()}.json`
    );

    const wb = XLSX.utils.book_new();
    const k1 = ['岗位名称', '公司名称', '薪资', '城市', '区域', '经验要求', '学历要求',
      '公司阶段', '公司规模', '行业', '技能标签', '福利待遇', '详细地址', '岗位状态',
      'HR活跃', 'HR姓名', 'HR职位', '岗位链接'];
    const ws1 = XLSX.utils.json_to_sheet(
      rows.map(j => Object.fromEntries(k1.map(k => [k, j[k] || '']))), { header: k1 });
    ws1['!cols'] = [25,22,14,8,10,12,10,10,12,15,35,35,30,10,16,10,18,60].map(w => ({ wch: w }));
    XLSX.utils.book_append_sheet(wb, ws1, sheetLabel);

    const ws2 = XLSX.utils.json_to_sheet(rows.map(j => ({
      岗位名称: j.岗位名称, 公司名称: j.公司名称, 薪资: j.薪资,
      岗位描述: j.岗位描述, 岗位链接: j.岗位链接,
    })));
    ws2['!cols'] = [25, 22, 14, 80, 60].map(w => ({ wch: w }));
    XLSX.utils.book_append_sheet(wb, ws2, 'JD详情');

    const buf = XLSX.write(wb, { bookType: 'xlsx', type: 'array' });
    setTimeout(() => dl(new Blob([buf], { type: 'application/octet-stream' }), `zhipin_${ts()}.xlsx`), 400);
  }

  // ── 详情页进度 badge ─────────────────────────────────────
  function mountDetailBadge(current, total) {
    let badge = document.getElementById('__ze_status__');
    if (!badge) {
      badge = document.createElement('div');
      badge.id = '__ze_status__';
      badge.style.cssText = `position:fixed;bottom:20px;right:20px;z-index:2147483647;
        background:rgba(0,0,0,.72);color:#fff;border-radius:20px;
        padding:8px 16px;font:13px/1.5 -apple-system,sans-serif;
        pointer-events:none;white-space:nowrap`;
      document.body.appendChild(badge);
    }
    badge.textContent = `Boss导出 ${current} / ${total}`;
  }

  // ── 详情页主逻辑 ─────────────────────────────────────────
  async function runDetailPage() {
    const session = await dbGet();
    if (!session || session.phase !== 'extracting') return;

    // 只处理脚本自己导航过来的页面，用户手动打开时静默退出
    if (!session.processingUrl) return;
    const targetSecId  = new URL(session.processingUrl).searchParams.get('securityId') || '';
    const targetEncId  = session.processingUrl.match(/\/job_detail\/([^.?]+)/)?.[1] || '';
    const currentSecId = new URLSearchParams(location.search).get('securityId') || '';
    const currentEncId = location.pathname.match(/\/job_detail\/([^.?/]+)/)?.[1] || '';
    const isIntended   = (targetSecId && targetSecId === currentSecId)
                      || (targetEncId && targetEncId === currentEncId);
    if (!isIntended) {
      console.log('[zhipin导出] 用户手动访问详情页，不干预');
      return;
    }

    const querySecId   = currentSecId;
    const encryptJobId = currentEncId;

    const idx = session.jobs.findIndex(j =>
      (querySecId   && j.securityId   === querySecId) ||
      (encryptJobId && j.encryptJobId === encryptJobId)
    );

    if (idx === -1 || session.jobs[idx].status === 'done') {
      navigateNext(session);
      return;
    }

    const total   = session.jobs.length;
    const doneNow = session.jobs.filter(j => j.status === 'done').length;
    mountDetailBadge(doneNow + 1, total);

    const jobInfo = await waitForJobInfo(10000);

    if (jobInfo) {
      const data = buildDataFromJobInfo(jobInfo);
      session.jobs[idx].data = { ...session.jobs[idx].data, ...data };
      console.log('[zhipin导出] XHR 提取成功:', data.岗位名称);
    } else {
      console.warn('[zhipin导出] XHR 超时，使用 DOM 兜底');
      const domData = extractFromDOM();
      for (const [k, v] of Object.entries(domData)) {
        if (v) session.jobs[idx].data[k] = v;
      }
    }

    session.jobs[idx].status = 'done';
    mountDetailBadge(session.jobs.filter(j => j.status === 'done').length, total);

    await dbSet(session);
    await sleep(1200 + jitter());
    navigateNext(session);
  }

  // returnUrl：任务完成后回到哪个列表页
  async function navigateNext(session) {
    const nextJob = session.jobs.find(j => j.status === 'pending');
    if (nextJob) {
      session.processingUrl = nextJob.jobUrl;
      await dbSet(session);
      location.href = nextJob.jobUrl;
    } else {
      session.phase = 'done';
      session.processingUrl = null;
      await dbSet(session);
      location.href = session.returnUrl || 'https://www.zhipin.com/web/geek/recommend?tab=4&sub=1';
    }
  }

  // ── 列表页通用 UI（收藏页 + 搜索页共用） ─────────────────
  const UI_CSS = `
    #__ze__{position:fixed;bottom:24px;right:24px;z-index:2147483647;
      background:#fff;border-radius:12px;box-shadow:0 4px 24px rgba(0,0,0,.2);
      padding:16px 18px;width:276px;font:13px/1.5 -apple-system,sans-serif;color:#222}
    #__ze__ h3{margin:0 0 10px;font-size:14px;padding-right:28px}
    #__ze__ button{display:block;width:100%;padding:9px;border:none;border-radius:8px;
      cursor:pointer;font-size:13px;font-weight:500;margin-bottom:6px}
    #ze_go{background:#00b96b;color:#fff}
    #ze_go:disabled{background:#bbb;cursor:not-allowed}
    #ze_resume{background:#0070f3;color:#fff}
    #ze_dl_partial{background:#f5a623;color:#fff}
    #ze_dl{background:#00b96b;color:#fff}
    #ze_clear{background:#f5f5f5;color:#555}
    #__ze__ #ze_x{position:absolute;top:10px;right:12px;background:none;border:none;
      font-size:16px;cursor:pointer;color:#aaa;padding:0 !important;width:auto !important;
      margin:0 !important;display:inline !important;border-radius:0}
    #ze_wrap{background:#f0f0f0;border-radius:4px;height:6px;margin:10px 0 6px;display:none}
    #ze_bar{height:6px;border-radius:4px;background:#00b96b;width:0%;transition:width .3s}
    #ze_st{color:#666;min-height:18px;font-size:12px}
  `;

  async function mountUI(pageTitle) {
    if (document.getElementById('__ze__')) return;

    const session = await dbGet();

    const el = document.createElement('div');
    el.id = '__ze__';
    el.innerHTML = `<style>${UI_CSS}</style>
      <button id="ze_x">✕</button>
      <h3>${pageTitle}</h3>
      <div id="ze_btns"></div>
      <div id="ze_wrap"><div id="ze_bar"></div></div>
      <div id="ze_st"></div>`;
    document.body.appendChild(el);

    el.querySelector('#ze_x').onclick = () => el.remove();

    const btns = el.querySelector('#ze_btns');
    const wrap = el.querySelector('#ze_wrap');
    const bar  = el.querySelector('#ze_bar');
    const st   = el.querySelector('#ze_st');

    const setStatus = (msg, cur, tot) => {
      st.textContent = msg;
      if (tot > 0) {
        wrap.style.display = 'block';
        bar.style.width = Math.min(100, cur / tot * 100).toFixed(0) + '%';
      }
    };

    const renderButtons = (phase, s) => {
      btns.innerHTML = '';
      if (!phase) {
        const go = document.createElement('button');
        go.id = 'ze_go'; go.textContent = '开始导出';
        go.onclick = () => startCollect(go);
        btns.appendChild(go);
        st.textContent = '点击开始扫描当前页所有岗位';
      } else if (phase === 'extracting') {
        const resume = document.createElement('button');
        resume.id = 'ze_resume'; resume.textContent = '继续抓取';
        resume.onclick = () => resumeExtract();
        btns.appendChild(resume);

        const dlPartial = document.createElement('button');
        dlPartial.id = 'ze_dl_partial'; dlPartial.textContent = '导出已抓取数据';
        dlPartial.onclick = () => {
          const doneJobs = (s?.jobs || []).filter(j => j.status === 'done');
          if (doneJobs.length === 0) { st.textContent = '暂无已完成数据'; return; }
          exportFiles(doneJobs, s?.sheetLabel || '岗位列表');
          st.textContent = `✅ 已导出 ${doneJobs.length} 个岗位`;
        };
        btns.appendChild(dlPartial);

        const clear = document.createElement('button');
        clear.id = 'ze_clear'; clear.textContent = '清除 / 重来';
        clear.onclick = () => clearAndReset();
        btns.appendChild(clear);

        const done = (s?.jobs || []).filter(j => j.status === 'done').length;
        st.textContent = `已抓 ${done} / ${(s?.jobs || []).length} 个，可继续`;
      } else if (phase === 'done') {
        const dlBtn = document.createElement('button');
        dlBtn.id = 'ze_dl'; dlBtn.textContent = '下载文件';
        dlBtn.onclick = () => {
          exportFiles(s.jobs, s?.sheetLabel || '岗位列表');
          st.textContent = '✅ 文件已下载';
        };
        btns.appendChild(dlBtn);

        const clear = document.createElement('button');
        clear.id = 'ze_clear'; clear.textContent = '清除 / 重来';
        clear.onclick = () => clearAndReset();
        btns.appendChild(clear);

        const done = (s?.jobs || []).filter(j => j.status === 'done').length;
        st.textContent = `✅ 完成！共 ${done} / ${(s?.jobs || []).length} 个岗位`;
        wrap.style.display = 'block';
        bar.style.width = '100%';
      }
    };

    const clearAndReset = async () => {
      await dbDel();
      renderButtons(undefined, null);
    };

    const resumeExtract = async () => {
      const s = await dbGet();
      if (!s) { renderButtons(undefined, null); return; }
      const firstPending = s.jobs.find(j => j.status === 'pending');
      if (firstPending) {
        s.processingUrl = firstPending.jobUrl;
        await dbSet(s);
        location.href = firstPending.jobUrl;
      } else {
        s.phase = 'done';
        await dbSet(s);
        renderButtons('done', s);
      }
    };

    const startCollect = async (btn) => {
      const jobLinks = document.querySelectorAll('a[href*="/job_detail/"]');
      if (jobLinks.length === 0) {
        st.textContent = '未找到岗位链接，请确认已在岗位列表页';
        return;
      }

      btn.disabled = true;
      wrap.style.display = 'block';

      try {
        const allJobs = await collectAllJobs((msg, cur, tot) => setStatus(msg, cur, tot));

        if (allJobs.length === 0) {
          st.textContent = '未找到岗位，请检查页面';
          btn.disabled = false;
          return;
        }

        // sheetLabel：收藏页用"收藏岗位"，搜索页用"搜索结果"
        const sheetLabel = isFavoritesPage() ? '收藏岗位' : '搜索结果';
        const newSession = {
          phase:         'extracting',
          jobs:          allJobs,
          returnUrl:     location.href,   // 完成后回到当前列表页
          sheetLabel,
          processingUrl: allJobs[0].jobUrl,
          startedAt:     Date.now(),
        };
        await dbSet(newSession);

        setStatus(`收集完成，共 ${allJobs.length} 个，即将跳转…`, 1, 1);
        await sleep(1000);
        location.href = allJobs[0].jobUrl;
      } catch (e) {
        st.textContent = '❌ ' + e.message;
        console.error('[zhipin导出]', e);
        btn.disabled = false;
      }
    };

    renderButtons(session?.phase, session);
  }

  // ── 入口 ─────────────────────────────────────────────────
  async function handlePage() {
    if (isDetailPage()) {
      runDetailPage();
      return;
    }

    const existing = document.getElementById('__ze__');

    if (isFavoritesPage()) {
      if (existing) existing.remove();
      mountUI('📋 收藏岗位导出');
    } else if (isSearchPage()) {
      if (existing) existing.remove();
      mountUI('🔍 搜索结果导出');
    } else {
      // 被 Boss直聘 从已下线岗位页重定向到此处时，跳过该岗位继续
      const session = await dbGet();
      if (session && session.phase === 'extracting') {
        if (session.processingUrl) {
          const idx = session.jobs.findIndex(
            j => j.jobUrl === session.processingUrl && j.status === 'pending'
          );
          if (idx !== -1) {
            console.warn('[zhipin导出] 检测到重定向，跳过已下线岗位:', session.processingUrl);
            session.jobs[idx].status = 'done';
            session.jobs[idx].data.岗位状态 = '已下线';
          }
          session.processingUrl = null;
          await dbSet(session);
          await sleep(800);
          navigateNext(session);
        } else {
          // processingUrl 未设置，跳回来源列表页让用户点继续
          console.warn('[zhipin导出] processingUrl 为空，返回列表页');
          await sleep(500);
          location.href = session.returnUrl || 'https://www.zhipin.com/web/geek/recommend?tab=4&sub=1';
        }
      }
    }
  }

  domReady(async () => {
    await handlePage();

    // 监听 SPA 路由变化（Boss直聘是单页应用，切页不刷新）
    let lastHref = location.href;
    const onRouteChange = () => {
      if (location.href === lastHref) return;
      lastHref = location.href;
      setTimeout(handlePage, 400); // 等新页面内容渲染
    };

    const _push    = history.pushState;
    const _replace = history.replaceState;
    history.pushState    = function () { _push.apply(this, arguments);    onRouteChange(); };
    history.replaceState = function () { _replace.apply(this, arguments); onRouteChange(); };
    window.addEventListener('popstate', onRouteChange);
  });

})();
