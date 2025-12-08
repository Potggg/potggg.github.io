/**
 * main.js
 * 노바서버 페트 계산기 메인 스크립트 (Web Worker 사용)
 */

const WORKER_BASE_URL = "https://github-proxy.potg.workers.dev";
const PETS_PATH = "data/pets.json";
const R8_PATH = "data/rank8.json";


/* ========= 상수 ========= */
const LS_TABLE = "novaPetTable_cache";
const LS_R8_KEY = "novaRank8Map_cache_v1";
const TOTAL = 178750;

/* ========= 즐겨찾기 (FAVS 변수와 함수) ========= */
const FAV_LS_KEY = "pet_favs_v1";
let FAVS = [];
function loadFavs(){
  try{
    const arr = JSON.parse(localStorage.getItem(FAV_LS_KEY)||"[]");
    return Array.isArray(arr) ? arr.filter(x=>typeof x==="string").slice(0,5) : [];
  }catch{ return []; }
}
function saveFavs(){ localStorage.setItem(FAV_LS_KEY, JSON.stringify(FAVS)); }
function isFav(name){ return FAVS.includes(name); }
function showToast(msg, ms=1500){
  const wrap = document.getElementById("toastWrap");
  const t = document.createElement("div");
  t.className = "toast"; t.textContent = msg;
  wrap.appendChild(t);
  void t.offsetWidth; t.classList.add("show");
  setTimeout(()=>{ t.classList.remove("show"); setTimeout(()=>wrap.removeChild(t), 250); }, ms);
}
function renderFavChips(){
  const box = document.getElementById("favChips");
  if(!box) return;
  box.innerHTML = "";
  if(FAVS.length===0){
    const span = document.createElement("span"); span.className="muted";
    // span.textContent="없음"; // 굳이 '없음'을 표시하지 않고 비워두는 것이 더 자연스러울 수 있음
    box.appendChild(span); return;
  }
  FAVS.forEach(n=>{
    const c = document.createElement("div");
    c.className="chip"; c.textContent=n; c.title=`${n} 선택`;
    c.addEventListener("click", ()=>{
      // 필터 초기화 후 해당 펫 선택
      petSearch.value=""; currentChosung="";
      Array.from(chosungBar.children).forEach(el=>el.classList.remove('on'));
      renderPetList();
      const items = Array.from(petList.children);
      const el = items.find(div => div.firstChild && div.firstChild.textContent === n);
      if(el){ el.click(); el.scrollIntoView({block:'center'}); }
    });
    box.appendChild(c);
  });
}
function addFav(name){
  if(isFav(name)) return;
  if(FAVS.length >= 5){ showToast("즐겨찾기는 최대 5개까지 가능합니다."); return; }
  FAVS.push(name); saveFavs(); renderFavChips(); renderPetList(); showToast("즐겨찾기에 추가되었습니다.");
}
function removeFav(name){
  const i = FAVS.indexOf(name);
  if(i>=0){ FAVS.splice(i,1); saveFavs(); renderFavChips(); renderPetList(); showToast("즐겨찾기에서 제거되었습니다."); }
}
function toggleFav(name){ isFav(name) ? removeFav(name) : addFav(name); }


/* ========= 전역 (GLOBAL_TABLE, ALL_NAMES, R8MAP) ========= */
let GLOBAL_TABLE = {};
let ALL_NAMES = [];
let R8MAP = {}; // name -> {count, obs_100_rank8: [[hp,atk,def,agi],...]}

/* ========= 유틸 (getJSONLS, setJSONLS, fetchJSON, fmtPct) ========= */
function getJSONLS(key, fallback={}){ try{ return JSON.parse(localStorage.getItem(key)||JSON.stringify(fallback)); }catch{ return fallback; } }
function setJSONLS(key, obj){ localStorage.setItem(key, JSON.stringify(obj)); }
function fetchJSON(url){ return fetch(url+`?v=${Date.now()}`,{cache:"no-store"}).then(r=>{ if(!r.ok) throw 0; return r.json();}); }
function fmtPct(x){
  if(!Number.isFinite(x)) return "—%";
  if(x === 0) return "0.0000%";
  if(x < 0.001) return x.toFixed(6) + "%";
  return x.toFixed(4) + "%";
}

/* ========= 초성(문자 → 초성) 유틸 (CHO_CODE, CHO_SIMPLE, getChosung) ========= */
const CHO_CODE = ['ㄱ','ㄲ','ㄴ','ㄷ','ㄸ','ㄹ','ㅁ','ㅂ','ㅃ','ㅅ','ㅆ','ㅇ','ㅈ','ㅉ','ㅊ','ㅋ','ㅌ','ㅍ','ㅎ'];
const CHO_SIMPLE = (c)=>({"ㄲ":"ㄱ","ㄸ":"ㄷ","ㅃ":"ㅂ","ㅆ":"ㅅ","ㅉ":"ㅈ"}[c]||c);
function getChosung(str){
  let out="";
  for(const ch of str){
    const code = ch.charCodeAt(0);
    if(code<0xAC00 || code>0xD7A3){ out+=ch; continue; }
    const idx = Math.floor((code - 0xAC00) / 588);
    out += CHO_SIMPLE(CHO_CODE[idx]);
  }
  return out;
}

/* ========= 원격 로드 (loadGlobalTable, loadRank8Map) ========= */
async function loadGlobalTable(){
  try{
    // 1차: 같은 도메인의 /data/pets.json (깃허브 페이지/로컬 호환)
    const obj = await fetchJSON(PETS_PATH);
    if(typeof obj!=="object" || Array.isArray(obj)) throw 0;
    GLOBAL_TABLE = obj; setJSONLS(LS_TABLE, obj);
  }catch{
    // 2차: 로컬스토리지 캐시 (네트워크 오류 대비)
    GLOBAL_TABLE = getJSONLS(LS_TABLE, {});
    console.warn("[pets] local fetch 실패 → localStorage 캐시 사용");
  }
  ALL_NAMES = Object.keys(GLOBAL_TABLE).sort((a,b)=>a.localeCompare(b,'ko'));
  
  // 즐겨찾기 검증(없는 이름 제거)
  FAVS = FAVS.filter(n => GLOBAL_TABLE[n]);
  saveFavs();
  renderFavChips();
}
async function loadRank8Map(){
  let isSuccess = false;
  try{
    // 1차: 네트워크 요청 시도
    const m = await fetchJSON(R8_PATH);
    if (typeof m==="object" && !Array.isArray(m)){
      R8MAP = m;
      // ⭐️ 추가: 성공 시 로컬 스토리지에 캐시 저장
      setJSONLS(LS_R8_KEY, m);
      isSuccess = true;
      return;
    }
  }catch(e){
    console.warn("[R8] Network fetch failed.");
  }
  
  if (!isSuccess) {
    // 2차: 네트워크 요청 실패 시 로컬 스토리지 캐시 사용
    R8MAP = getJSONLS(LS_R8_KEY, {});
    console.warn("[R8] local fetch 실패 → localStorage 캐시 사용");
  }
  
  // R8MAP이 비어있으면 초기화합니다.
  if (Object.keys(R8MAP).length === 0) {
      R8MAP = {};
  }
}


/* ========= DOM 요소 참조 ========= */
const chosungBar = document.getElementById('chosung');
const chosungTokens = document.getElementById('chosungTokens');
const petList = document.getElementById('petList');
const petSearch = document.getElementById('petSearch');

const s0hp = document.getElementById('s0_hp');
const s0atk= document.getElementById('s0_atk');
const s0def= document.getElementById('s0_def');
const s0agi= document.getElementById('s0_agi');

const sghp = document.getElementById('sg_hp');
const sgatk= document.getElementById('sg_atk');
const sgdef= document.getElementById('sg_def');
const sgagi= document.getElementById('sg_agi');

const obshp = document.getElementById('obs_hp');
const obsatk= document.getElementById('obs_atk');
const obsdef= document.getElementById('obs_def');
const obsagi= document.getElementById('obs_agi');

const kpiSuccess = document.getElementById('kpiSuccess');
const kpiAppear  = document.getElementById('kpiAppear');
const kpiTries   = document.getElementById('kpiTries');
const distBox = document.getElementById('dist');

const btnCalc = document.getElementById('btnCalc');
const btnReset= document.getElementById('btnReset');
const btnClear= document.getElementById('btnClear');

const totMatches = document.getElementById('totMatches');
const rank8Matches = document.getElementById('rank8Matches');

let currentChosung="";
let selectedName=null;
let selectedRow=null;
let selectedItemEl=null; // 선택 하이라이트 유지

// ===== 바디 레벨 툴팁 =====
const tipEl = document.createElement('div');
tipEl.className = 'floating-tip';
document.body.appendChild(tipEl);
let tipTimer = null;

function hideTip(){ tipEl.classList.remove('show'); }
function showTip(target){
  const text = target.getAttribute('data-tip');
  if(!text){ hideTip(); return; }
  const lines = String(text).split('\n');
  tipEl.textContent = '';
  lines.forEach((line,i)=>{
    tipEl.appendChild(document.createTextNode(line));
    if(i < lines.length-1) tipEl.appendChild(document.createElement('br'));
  });
  tipEl.classList.add('show');
  tipEl.style.left = '-9999px'; tipEl.style.top  = '-9999px'; tipEl.removeAttribute('data-pos');
  tipEl.getBoundingClientRect();
  const rect = target.getBoundingClientRect();
  const tw = tipEl.offsetWidth, th = tipEl.offsetHeight;
  const margin = 8;
  let pos = 'top';
  let left = rect.left + rect.width/2 - tw/2;
  left = Math.max(8, Math.min(left, window.innerWidth - tw - 8));
  let top = rect.top - th - margin;
  if(top < 6){ top = rect.bottom + margin; pos = 'bottom'; }
  tipEl.dataset.pos = pos;
  tipEl.style.left = `${Math.round(left)}px`;
  tipEl.style.top  = `${Math.round(top)}px`;
}
petList.addEventListener('mouseover', (e)=>{
  const t = e.target.closest('.tag.tip'); if(!t) return; showTip(t);
}, true);
petList.addEventListener('mouseout', (e)=>{
  const t = e.target.closest('.tag.tip'); if(!t) return; hideTip();
}, true);
petList.addEventListener('focusin', (e)=>{
  const t = e.target.closest('.tag.tip'); if(!t) return; showTip(t);
});
petList.addEventListener('focusout', (e)=>{
  const t = e.target.closest('.tag.tip'); if(!t) return; hideTip();
});
petList.addEventListener('touchstart', (e)=>{
  const t = e.target.closest('.tag.tip'); if(!t) return; e.stopPropagation(); showTip(t);
  clearTimeout(tipTimer); tipTimer = setTimeout(hideTip, 1800);
}, {passive:true});
window.addEventListener('scroll', hideTip, true);
window.addEventListener('resize', hideTip);

/* ========= 초성 키패드 ========= */
const CHO = ['ㄱ','ㄴ','ㄷ','ㄹ','ㅁ','ㅂ','ㅅ','ㅇ','ㅈ','ㅊ','ㅋ','ㅌ','ㅍ','ㅎ'];

function renderChosungTokens(){
  chosungTokens.innerHTML = "";
  for(const ch of currentChosung){
    const t = document.createElement('div');
    t.className = 'chip'; t.style.cursor = 'default'; t.textContent = ch;
    chosungTokens.appendChild(t);
  }
}
CHO.forEach(c=>{
  const chip=document.createElement('div');
  chip.className='chip'; chip.textContent=c;
  chip.addEventListener('click', ()=>{
    currentChosung += c;
    renderPetList();
    renderChosungTokens();
    Array.from(chosungBar.children).forEach(el=>el.classList.remove('on'));
    chip.classList.add('on');
  });
  chosungBar.appendChild(chip);
});
petSearch.addEventListener('input', renderPetList);

/* ========= 목록 ========= */
function renderPetList(){
  const kw = (petSearch.value||"").trim();
  const names = ALL_NAMES.length? ALL_NAMES : Object.keys(GLOBAL_TABLE);
  const list = names.filter(n=>{
    const a = kw? n.includes(kw): true;
    const b = currentChosung? getChosung(n).startsWith(currentChosung): true;
    return a && b;
  });

  petList.innerHTML="";
  if(list.length===0){
    const d=document.createElement('div'); d.className='item'; d.textContent='결과 없음';
    petList.appendChild(d);
    return;
  }

  list.forEach(n=>{
    const div=document.createElement('div'); div.className='item';

    const left=document.createElement('div'); left.textContent = n;
    const right=document.createElement('div'); right.className="tags";

    // 8등급 보장 배지
    const r8 = R8MAP[n];
    if (r8 && (Array.isArray(r8.obs_100_rank8) ? r8.obs_100_rank8.length : (r8.length||0))) {
      const sets = Array.isArray(r8.obs_100_rank8) ? r8.obs_100_rank8 : r8;
      const tag2 = document.createElement('span');
      tag2.className = 'tag rank8 tip';
      tag2.textContent = '100%';

      const maxShow = 20;
      const preview = sets.slice(0, maxShow).map(a=>`(${a[0]},${a[1]},${a[2]},${a[3]})`).join(' · ');
      const more = sets.length>maxShow ? ` 외 ${sets.length-maxShow}세트` : '';
      const tipText = `8등급 보장 초기치\n${preview}${more}`;
      tag2.setAttribute('data-tip', tipText);

      tag2.tabIndex = 0;
      const stop = (e)=>{ e.stopPropagation(); };
      tag2.addEventListener('click', stop);
      tag2.addEventListener('touchstart', stop, {passive:true});

      right.appendChild(tag2);
    }

    /* ★ 즐겨찾기 별 배지 */
    const star = document.createElement('span');
    const favOn = isFav(n);
    star.className = 'tag fav' + (favOn ? ' on' : '');
    star.textContent = favOn ? '즐겨찾기' : '즐겨찾기';
    star.title = favOn ? '즐겨찾기 삭제' : '즐겨찾기 추가';
    star.setAttribute('role','button');
    star.setAttribute('aria-pressed', favOn ? 'true' : 'false');
    star.tabIndex = 0;
    const toggle = (e)=>{ e.stopPropagation(); toggleFav(n); };
    star.addEventListener('click', toggle);
    star.addEventListener('keydown', (e)=>{ if(e.key==='Enter' || e.key===' '){ toggle(e); }});
    right.appendChild(star);

    div.appendChild(left);
    div.appendChild(right);
    div.addEventListener('click', ()=>{
      if(selectedItemEl) selectedItemEl.classList.remove('selected');
      div.classList.add('selected');
      selectedItemEl = div;
      selectPetName(n);
    });
    if (n === selectedName) { div.classList.add('selected'); selectedItemEl = div; }
    petList.appendChild(div);
  });

  renderChosungTokens();
}

/* ========= 펫 선택 ========= */
function selectPetName(n){
  selectedName=n;
  selectedRow=GLOBAL_TABLE[n]||null;

  if(selectedRow?.s0){
    s0hp.value=selectedRow.s0.hp??""; s0atk.value=selectedRow.s0.atk??"";
    s0def.value=selectedRow.s0.def??""; s0agi.value=selectedRow.s0.agi??"";
  }else{ s0hp.value=s0atk.value=s0def.value=s0agi.value=""; }

  if(selectedRow?.sg){
    sghp.value=selectedRow.sg.hp??""; sgatk.value=selectedRow.sg.atk??"";
    sgdef.value=selectedRow.sg.def??""; sgagi.value=selectedRow.sg.agi??"";
  }else{ sghp.value=sgatk.value=sgdef.value=sgagi.value=""; }

  if(selectedRow?.s0){
    obshp.value = Math.floor(selectedRow.s0.hp??NaN)||"";
    obsatk.value= Math.floor(selectedRow.s0.atk??NaN)||"";
    obsdef.value= Math.floor(selectedRow.s0.def??NaN)||"";
    obsagi.value= Math.floor(selectedRow.s0.agi??NaN)||"";
  }else{
    obshp.value=obsatk.value=obsdef.value=obsagi.value="";
  }
  showKpis(null);
}

function resetCalcButton() {
  btnCalc.textContent = "계산";
  btnCalc.disabled = false;
}

/* ===== 공통 유틸 ===== */
function getCSS(name){ return getComputedStyle(document.documentElement).getPropertyValue(name).trim(); }
function resolveR(el){
  const rSelf = parseFloat(el.getAttribute('r'));
  if (isFinite(rSelf)) return rSelf;
  const href = el.getAttribute('href') || el.getAttribute('xlink:href');
  if (href && href[0]==='#'){
    const ref = el.ownerSVGElement.getElementById(href.slice(1));
    const rr = parseFloat(ref && ref.getAttribute('r'));
    if (isFinite(rr)) return rr;
  }
  return 45;
}
function makeRing(fillEl, maskStrokeEl, colorGetter){
  const r = resolveR(fillEl);
  const C = 2 * Math.PI * r;
  const baseStroke = fillEl.style.stroke || fillEl.getAttribute('stroke') || '#fff';
  const strokeOn = (col)=>{ fillEl.style.stroke = col || (colorGetter? colorGetter(): baseStroke); };
  const strokeOff = ()=>{ fillEl.style.stroke = 'none'; };
  const clamp01 = (x)=> (Number.isFinite(x)? Math.max(0, Math.min(1,x)) : 0);

  function setFrac(frac){
    const f = clamp01(frac);
    if (f === 0){
      fillEl.setAttribute('stroke-dasharray','0 1');
      fillEl.setAttribute('stroke-dashoffset','0');
      if(maskStrokeEl){
        maskStrokeEl.setAttribute('stroke-dasharray','0 1');
        maskStrokeEl.setAttribute('stroke-dashoffset','0');
      }
      strokeOff();
      return;
    }
    const dash=C, gap=C, off=(1-f)*C;
    fillEl.setAttribute('stroke-dasharray', `${dash} ${gap}`);
    fillEl.setAttribute('stroke-dashoffset', `${off}`);
    if(maskStrokeEl){
      maskStrokeEl.setAttribute('stroke-dasharray', `${dash} ${gap}`);
      maskStrokeEl.setAttribute('stroke-dashoffset', `${off}`);
    }
    strokeOn();
  }
  return { setFrac, C };
}
function polar0(cx,cy,r,deg){ const t=deg*Math.PI/180; return [cx + r*Math.cos(t), cy + r*Math.sin(t)]; }
function arcPath0(cx,cy,r,deg0,deg1){
  let s=deg0, e=deg1; while(e<s) e+=360;
  const span=e-s, large=span>180?1:0;
  const [x0,y0]=polar0(cx,cy,r,s), [x1,y1]=polar0(cx,cy,r,e);
  return `M ${x0} ${y0} A ${r} ${r} 0 ${large} 1 ${x1} ${y1}`;
}

/* ===== 1) 성공% + HUD (setSuccess) ===== */
const succFill = document.getElementById('succFill');
const succMaskStroke = document.getElementById('succMaskStroke');
const { setFrac: _succSetFrac } = makeRing(succFill, succMaskStroke, ()=>getCSS('--accent'));
const hud = document.getElementById('succHUD');
const tail= document.getElementById('succTail');
const core= document.getElementById('succCore');
const flare= document.getElementById('succFlare');
const SUCCR = resolveR(succFill);
let head=0, run=false, lastTs=0;

function tick(ts){
  if(!run) return;
  if(!lastTs) lastTs=ts;
  const dt=(ts-lastTs)/1000; lastTs=ts;
  const circum=2*Math.PI*SUCCR, pxPerSec=parseFloat(getCSS('--hud-speed'))||120;
  const degPerSec=(pxPerSec/circum)*360;
  head=(head + degPerSec*dt) % 360;

  const TAIL_SPAN=360*0.22, CORE_SPAN=360*0.10;
  tail.setAttribute('d', arcPath0(50,50,SUCCR, head-TAIL_SPAN, head));
  core.setAttribute('d', arcPath0(50,50,SUCCR, head-CORE_SPAN, head));
  const [fx,fy]=polar0(50,50,SUCCR, head);
  flare.setAttribute('cx', fx.toFixed(2)); flare.setAttribute('cy', fy.toFixed(2));
  requestAnimationFrame(tick);
}
function setSuccess(pct){
  const f = Math.max(0, Math.min(100, Number(pct)||0))/100;
  _succSetFrac(f);
  document.getElementById('kpiSuccess').textContent = (f*100).toFixed(4) + '%';
  if(f<=0){
    hud.style.opacity=0; run=false; lastTs=0; head=0;
    tail.setAttribute('d',''); core.setAttribute('d','');
  }else{
    hud.style.opacity=1; if(!run){ run=true; lastTs=0; requestAnimationFrame(tick); }
  }
}

/* ===== 2) 출현% — 게이지 최대 2% (setAppear) ===== */
const apFill = document.getElementById('apFill');
const { setFrac: _apSetFrac } = makeRing(apFill, null, ()=> '#7fd4ff');
function setAppear(pctReal){
  const p = Math.max(0, Number(pctReal)||0);
  const frac = Math.min(p, 2) / 2; // 0~2% → 0~100%
  _apSetFrac(frac);
  document.getElementById('kpiAppear').textContent = p.toFixed(6) + '%';
  document.getElementById('apBadge').style.display = (p>2 ? '' : 'none');
}

/* ===== 3) 기대값 — 200↑ 항상 100% + 색상(초/노/빨) (setTries) ===== */
const trFill = document.getElementById('trFill');
let currTries = 1;

function colorByTries(x) {
  return (x < 50) ? getCSS('--ok')      // 초록
       : (x < 100) ? getCSS('--warn')   // 노랑
       : getCSS('--bad');               // 빨강
}

const { setFrac: _trSetFrac } = makeRing(trFill, null, () => colorByTries(currTries));

function setTries(t) {
  currTries = Number(t);

  if (!Number.isFinite(t) || t <= 0) {
    trFill.style.stroke = colorByTries(1); 
    _trSetFrac(0);
    document.getElementById('kpiTries').textContent = '1회';
    return;
  }
  
  let frac;
  if (currTries >= 200) frac = 1;
  else frac = currTries / 200;

  trFill.style.stroke = colorByTries(currTries); 
  _trSetFrac(frac);

  const finalTries = Math.floor(currTries) + 1; 

  document.getElementById('kpiTries').textContent = finalTries + '회';
}

/* ===== KPI 렌더 교체 (showKpis) ===== */
function showKpis(res){
  if(!res){
    // 값 표시
    kpiSuccess.textContent = "—%";
    kpiAppear .textContent = "—%";
    kpiTries .textContent = "0회";
    // 링 리셋(크기·비율 유지)
    setSuccess(0);
    setAppear(0);
    currTries = 0;
    _trSetFrac(0);
    // 부가정보 리셋
    totMatches.textContent = "0";
    rank8Matches.textContent = "0";
    distBox.innerHTML = "";
    return;
  }

  const matches = res.matches|0;
  const rank8 = res.rank8|0;
  const appear = matches/TOTAL*100; // 실제 출현 %

  const successPct = matches ? (rank8/matches*100) : 0; // 성공 %

  const tries = successPct > 0 ?
  (100/successPct) : 0;

  // 수치 텍스트
  kpiSuccess.textContent = fmtPct(successPct);
  kpiAppear .textContent = fmtPct(appear);

  // 링 반영
  setSuccess(successPct);
  setAppear(appear);
  setTries(isFinite(tries) ? tries : 1);

  // 요약 수치 및 분포
  totMatches.textContent = matches.toLocaleString();
  rank8Matches.textContent = rank8.toLocaleString();

  const entries = Object.entries(res.dist)
  .map(([r,c]) => ({r:parseInt(r,10), c}))
  .sort((a,b) => b.r - a.r || b.c - a.c);

  let html = `<table class="table"><thead><tr><th>등급(베이스합)</th><th>건수</th><th>비율</th></tr></thead><tbody>`;
  const total = matches || 1;
  entries.forEach(e=>{
    const pct = (e.c/total*100).toFixed(2);
    const cls = (e.r===8 ? "ok" : (e.r>=5 ? "warn" : ""));
    html += `<tr><td class="${cls}">${e.r}</td><td>${e.c.toLocaleString()}</td><td>${pct}%</td></tr>`;
  });
  html += `</tbody></table>`;
  distBox.innerHTML = html;
}

/* ========= k/u 추정 (inferKU_JJYAL) ========= */
// Decimal.js는 Web Worker에서도 사용되므로, 워커 파일에 포함시키거나 별도로 로드해야 합니다.
// 여기서는 `index.html`에서 로드된 Decimal.js를 사용하기 위해, 추정 로직은 메인 스레드에 유지합니다.

const ESET = Array.from({length: ((575-435)/5)+1 }, (_,i) => 575 - i*5);

function solveUFromSG_JJYAL(SG, e){
  // Decimal.js가 index.html에서 로드되었다고 가정하고 사용합니다.
  if (typeof Decimal === 'undefined') {
    console.error("Decimal.js is not loaded.");
    return null;
  }
  try{
    if(!SG || ![SG.hp,SG.atk,SG.def,SG.agi].every(Number.isFinite)) return null;
    Decimal.set({ precision:50, rounding: Decimal.ROUND_HALF_UP });

    const eD = new Decimal(e);
    const f = eD.dividedBy(10000);
    const d = new Decimal(SG.agi).times(10000).dividedBy(eD).minus(2.5);
    const dRound = d.round();
    const dPlus25 = dRound.plus(2.5);

    const rhs1 = new Decimal(SG.hp).minus( dPlus25.times(f) ).dividedBy(f);
    const rhs2 = new Decimal(SG.atk).minus( dPlus25.times(f).times(0.05) ).dividedBy(f);
    const rhs3 = new Decimal(SG.def).minus( dPlus25.times(f).times(0.05) ).dividedBy(f);

    let A = [
      [ new Decimal(4), new Decimal(1), new Decimal(1), rhs1 ],
      [ new Decimal(0.1), new Decimal(1), new Decimal(0.1), rhs2 ],
      [ new Decimal(0.1), new Decimal(0.1), new Decimal(1), rhs3 ],
    ];
    for(let i=0;i<3;i++){
      let mr=i; let mv=A[i][i].abs();
      for(let j=i+1;j<3;j++){ const t=A[j][i].abs(); if(t.greaterThan(mv)){mr=j; mv=t;} }
      if(mr!==i){ const tmp=A[i]; A[i]=A[mr]; A[mr]=tmp; }
      const piv=A[i][i];
      for(let j=i;j<4;j++) A[i][j]=A[i][j].dividedBy(piv);
      for(let k=0;k<3;k++){
        if(k===i) continue;
        const fac=A[k][i];
        for(let j=i;j<4;j++) A[k][j]=A[k][j].minus( fac.times(A[i][j]) );
      }
    }
    const aPrime=A[0][3], bPrime=A[1][3], cPrime=A[2][3];

    const u_hp = aPrime.minus(2.5).round();
    const u_atk = bPrime.minus(2.5).round();
    const u_def = cPrime.minus(2.5).round();
    const u_agi = dRound;

    const r2 = x => new Decimal(x).toDecimalPlaces(2);
    const hp_chk = r2( f.times( u_hp.plus(2.5).times(4).plus(u_atk.plus(2.5)).plus(u_def.plus(2.5)).plus(u_agi.plus(2.5)) ) );
    const atk_chk = r2( f.times( u_hp.plus(2.5).times(0.1).plus(u_atk.plus(2.5)).plus(u_def.plus(2.5).times(0.1)).plus(u_agi.plus(2.5).times(0.05)) ) );
    const def_chk = r2( f.times( u_hp.plus(2.5).times(0.1).plus(u_atk.plus(2.5).times(0.1)).plus(u_def.plus(2.5)).plus(u_agi.plus(2.5).times(0.05)) ) );
    const agi_chk = r2( f.times( u_agi.plus(2.5) ) );

    const err = hp_chk.minus(r2(SG.hp)).abs()
    .plus(atk_chk.minus(r2(SG.atk)).abs())
    .plus(def_chk.minus(r2(SG.def)).abs())
    .plus(agi_chk.minus(r2(SG.agi)).abs());

    return { u:{hp:+u_hp, atk:+u_atk, def:+u_def, agi:+u_agi}, e, sg_err:+err };
  }catch(e){ return null; }
}

function s0_from_k_u_jjyal(k,u){
  const fac = k/100;
  const vhp = (u.hp + 2.5) * fac;
  const vatk = (u.atk+ 2.5) * fac;
  const vdef = (u.def+ 2.5) * fac;
  const vagi = (u.agi+ 2.5) * fac;
  const s_hp = Math.floor(vhp*4 + vatk + vdef + vagi);
  const s_atk= Math.floor(vhp*0.1 + vatk + vdef*0.1 + vagi*0.05);
  const s_def= Math.floor(vhp*0.1 + vatk*0.1 + vdef + vagi*0.05);
  const s_agi= Math.floor(vagi);
  return [s_hp,s_atk,s_def,s_agi];
}
function fitKFromS0_JJYAL(S0int,u){
  let best=null;
  for(let k=10;k<=100;k++){
    const s = s0_from_k_u_jjyal(k,u);
    const l1 = Math.abs(s[0]-S0int[0]) + Math.abs(s[1]-S0int[1]) + Math.abs(s[2]-S0int[2]) + Math.abs(s[3]-S0int[3]);
    const ok = (l1===0);
    if(!best || (ok && !best.ok)
      || (!best.ok && l1<best.l1)) best={k,l1,ok};
    if(ok) break;
  }
  return best;
}
function inferKU_JJYAL(S0, SG){
  const S0int = S0.map(x=>Math.floor(x));
  let best=null;
  for(const e of ESET){
    const sol = solveUFromSG_JJYAL(SG, e);
    if(!sol) continue;
    const fit = fitKFromS0_JJYAL(S0int, sol.u);
    if(!fit) continue;
    const score = (fit.ok?0:1000) + fit.l1*10 + (sol.sg_err||0);
    const cand = {k:fit.k, u:sol.u, e, sg_err:sol.sg_err, s0_l1:fit.l1, s0_ok:fit.ok, score};
    if(!best || cand.score<best.score) best=cand;
  }
  return best;
}

/* =================================================================
 * Web Worker 설정 및 통신
 * ================================================================= */

// Web Worker 인스턴스 생성
const calculatorWorker = new Worker('calculator.worker.js');

// 워커에서 결과가 왔을 때 처리
calculatorWorker.onmessage = (e) => {
  const { matches, rank8, dist } = e.data;
  showKpis({ matches, rank8, dist });
  resetCalcButton();
};

// 워커에서 오류 발생 시 처리
calculatorWorker.onerror = (error) => {
  console.error("Worker Error:", error);
  alert("계산 중 워커 오류가 발생했습니다.");
  resetCalcButton();
};


/* ========= 계산 버튼 클릭 이벤트 (Web Worker에 작업 전달) ========= */
btnCalc.addEventListener('click', async ()=>{
  // 계산 시작 시 버튼 상태 변경
  btnCalc.textContent = "계산중...";
  btnCalc.disabled = true;

  try {
    if(!selectedName){ 
      alert("페트를 먼저 선택하세요."); 
      resetCalcButton();
      return; 
    }
    const obs=[obshp,obsatk,obsdef,obsagi].map(e=>parseInt(e.value,10));
    if(obs.some(v=>!Number.isFinite(v))){ 
      alert("관측 표기치(정수)를 모두 입력하세요."); 
      resetCalcButton();
      return; 
    }

    const row=GLOBAL_TABLE[selectedName]||{};
    if(!row?.s0 || !row?.sg){ 
      alert("이 페트는 S0/SG가 등록되어 있지 않습니다."); 
      resetCalcButton();
      return; 
    }

    let k=row.k, u=row.u;
    if(!(Number.isFinite(k) && u && [u.hp,u.atk,u.def,u.agi].every(Number.isFinite))){
      // k/u 추정이 필요한 경우 메인 스레드에서 수행
      const S0=[row.s0.hp, row.s0.atk, row.s0.def, row.s0.agi];
      const SG=row.sg;
      const fit = inferKU_JJYAL(S0, SG);
      if(!fit){ 
        alert("k/u 추정 실패: S0/SG를 확인하세요."); 
        resetCalcButton();
        return; 
      }
      k=fit.k; u=fit.u;
    }
    
    // Web Worker에 계산 작업 전달
    calculatorWorker.postMessage({
      k,
      u,
      obs
    });

  } catch(e) {
    console.error(e);
    alert("계산 중 오류가 발생했습니다.");
    resetCalcButton();
  }
});


/* ========= 리셋/클리어 이벤트 ========= */
btnReset.addEventListener('click', ()=>{
  selectedName=null; selectedRow=null;
  petSearch.value=""; currentChosung="";
  Array.from(chosungBar.children).forEach(el=>el.classList.remove('on'));
  petList.querySelectorAll('.item.selected').forEach(el=>el.classList.remove('selected'));
  selectedItemEl = null;
  renderPetList();
  [s0hp,s0atk,s0def,s0agi,sghp,sgatk,sgdef,sgagi,obshp,obsatk,obsdef,obsagi].forEach(i=>i.value="");
  showKpis(null);
  resetCalcButton();
});
btnClear.addEventListener('click', ()=>{
  petSearch.value=""; currentChosung="";
  renderChosungTokens();
  Array.from(chosungBar.children).forEach(el=>el.classList.remove('on'));
  petList.querySelectorAll('.item.selected').forEach(el=>el.classList.remove('selected'));
  selectedItemEl = null;
  renderPetList();
});

/* ========= 관측치 입력: 정수 + 1~100 범위 제한 ========= */
const intOnlyInputs = [obshp, obsatk, obsdef, obsagi];

function enableWheelStep(el){
  el.addEventListener('wheel',(e)=>{
    if(document.activeElement!==el) return;
    e.preventDefault();
    const delta = e.deltaY < 0 ? 1 : -1;
    let curr = parseInt(el.value || "0", 10);
    curr += delta;
    if (curr < 0) curr = 0;
    if (curr > 100) curr = 100;
    el.value = String(curr);
  }, {passive:false});
}
[obsatk,obshp,obsdef,obsagi].forEach(enableWheelStep);
document.addEventListener('click', (e)=>{
  const btn = e.target.closest('[data-delta][data-target]'); if(!btn) return;
  const id = btn.getAttribute('data-target'); const delta = parseInt(btn.getAttribute('data-delta'),10);
  const input=document.getElementById(id); if(!input) return;
  let curr=parseInt(input.value||"0",10); 
  curr += delta;
  if (curr < 0) curr = 0;
  if (curr > 100) curr = 100;
  input.value = String(curr);
});

intOnlyInputs.forEach(input => {
  // ① HTML 속성 반영
  input.min = 0;
  input.max = 100;
  input.step = 1;

  // ② 소수점, 음수, e/E, 콤마 입력 차단
  input.addEventListener('keydown', (e) => {
    if (['.', ',', 'e', 'E', '-'].includes(e.key)) {
      e.preventDefault();
    }
  });

  // ③ 붙여넣기 및 직접 입력 시 숫자만 + 범위 자동 보정
  input.addEventListener('input', () => {
    let val = input.value.replace(/\D/g, ''); // 숫자만 남김
    if (val === '') return (input.value = '');
    let num = parseInt(val, 10);
    if (num < 0) num = 0;
    if (num > 100) num = 100;
    input.value = num;
  });
});
  
/* ========= 부팅 ========= */
(async function init(){
  FAVS = loadFavs();
  renderFavChips();
  await loadGlobalTable();
  await loadRank8Map();
  console.log("✅ JSON 로드 완료 pets:", Object.keys(GLOBAL_TABLE).length, "rank8:", Object.keys(R8MAP).length);
  renderPetList();

})();

