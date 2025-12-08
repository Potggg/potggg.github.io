/**
 * calculator.worker.js
 * 페트 매칭 계산(enumerate_jjyal)을 담당하는 Web Worker 스크립트
 */

// Decimal.js 로드 (index.html에서 로드된 것과 별개로 워커 내부에서 로드해야 함)
importScripts('https://cdnjs.cloudflare.com/ajax/libs/decimal.js/10.6.0/decimal.min.js');

/**
 * [Web Worker용] k/u 기반 페트 초기치 완전 탐색 계산
 * @param {{k:number, u:{hp:number, atk:number, def:number, agi:number}}} pku 펫의 k 값과 u 값
 * @param {number[]} obs 관측된 1레벨 표기치 [hp, atk, def, agi]
 * @returns {{matches:number, rank8:number, dist:{[rank:string]:number}}} 계산 결과
 */
function enumerate_jjyal(pku, obs){
    // Decimal.js 사용을 위해 전역 범위에서 접근 가능하도록 함
    if (typeof Decimal === 'undefined') {
        throw new Error("Decimal.js is not available in the worker.");
    }
    Decimal.set({ precision:50, rounding: Decimal.ROUND_HALF_UP });

    const k = new Decimal(pku.k);
    const fac = k.dividedBy(100);
    const u = pku.u;

    const obsHp = obs[0], obsAtk = obs[1], obsDef = obs[2], obsAgi = obs[3];

    let matches = 0, rank8 = 0;
    const dist = {};

    // 4개 항목의 보너스 레벨 (0~10) 합은 항상 10
    // 4개 항목의 베이스 등급 (-2~+2)
    // 총 11^3 * 5^4 = 1,331 * 625 = 831,875번의 연산이 수행됩니다.
    
    // 성능 최적화를 위해 베이스 등급 루프를 먼저 돌립니다.
    for(let ar=-2; ar<=2; ar++){
    for(let dr=-2; dr<=2; dr++){
    for(let gr=-2; gr<=2; gr++){
    for(let hr=-2; hr<=2; hr++){
        const baseRank = ar + dr + gr + hr;
        
        for(let ab=0; ab<=10; ab++){
        for(let db=0; db<=10; db++){
        for(let gb=0; gb<=10; gb++){
            const hb = 10 - ab - db - gb;
            if(hb < 0 || hb > 10) continue;

            const baseA = new Decimal(u.atk + ar + ab);
            const baseD = new Decimal(u.def + dr + db);
            const baseG = new Decimal(u.agi + gr + gb);
            const baseH = new Decimal(u.hp + hr + hb);

            const iA = baseA.times(fac);
            const iD = baseD.times(fac);
            const iG = baseG.times(fac);
            const iH = baseH.times(fac);

            // 최종 초기치 계산
            // Decimal.js의 toFixed()는 문자열을 반환하므로 toNumber()를 사용합니다.
            const calcAtk = iH.times(0.1).plus(iA).plus(iD.times(0.1)).plus(iG.times(0.05)).floor().toNumber();
            const calcDef = iH.times(0.1).plus(iA.times(0.1)).plus(iD).plus(iG.times(0.05)).floor().toNumber();
            const calcAgi = iG.floor().toNumber();
            const calcHp  = iH.times(4).plus(iA).plus(iD).plus(iG).floor().toNumber();

            // 관측치와 일치하는지 확인
            if(calcAtk===obsAtk && calcDef===obsDef && calcAgi===obsAgi && calcHp===obsHp){
                matches++;
                dist[baseRank] = (dist[baseRank]||0) + 1;
                if(baseRank === 8) rank8++;
            }
        }
        }
        }
    }
    }
    }
    }

    return {matches, rank8, dist};
}


// 메인 스크립트에서 메시지(계산 요청)를 받았을 때 처리
self.onmessage = (e) => {
    const { k, u, obs } = e.data;
    
    if (k && u && obs) {
        try {
            const result = enumerate_jjyal({ k, u }, obs);
            // 계산 결과를 메인 스크립트로 다시 보냄
            self.postMessage(result);
        } catch (error) {
            console.error("Calculation in worker failed:", error);
            // 오류 발생 시 메인 스크립트로 오류 메시지 전송 (필요시)
            // self.postMessage({ error: error.message });
        }
    }
};