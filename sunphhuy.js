const axios = require('axios');
const fs = require('fs');
const path = require('path');
const http = require('http'); // Thêm để tạo API lấy kết quả dự đoán

// --- Cấu hình & Khởi tạo ---
const API_URL = "https://apisunlon.onrender.com/sun";
const DATA_FILE = "collected_data/sunwin_tx.json";
const STATS_FILE = "database/stats.json";
// Các giới hạn
const MIN_DATA_FOR_PREDICTION = 10;     // ✅ Đã sửa: đủ 10 phiên là bắt đầu dự đoán
const MAX_PREDICTIONS = 100000;          // Dự đoán tối đa 100k phiên
const MAX_STORAGE = 1000000;             // Lưu trữ tối đa 1000k phiên
const API_PORT = 3000;                   // Cổng mở API /sun lấy kết quả dự đoán

const vnNow = () => {
    const d = new Date();
    return new Date(d.getTime() + (7 * 60 * 60 * 1000)).toISOString();
};
let stats = {
    total: 0, correct: 0, wrong: 0,
    last_prediction: null,
    last_prediction_full: null, // ✅ Thêm: lưu đầy đủ thông tin để trả qua /sun
    start_time: vnNow(),
    history: [],
    total_predictions_made: 0,
    prediction_started: false  // Đánh dấu đã bắt đầu dự đoán chưa
};
class TX_LogicPen_V4 {
    constructor() {
        this.error_streak = 0;
        this.last_prediction = null;
        this.history = [];
    }
    loadData(data) {
        this.history = [...data].sort((a, b) => (b.phien || 0) - (a.phien || 0));
    }
    _arr() {
        return this.history.map(s => 
            (s.ket_qua || '').toUpperCase().replace('XỈU', 'XIU').replace('TÀI', 'TAI')
        );
    }
    _points() {
        return this.history
            .filter(s => s.tong !== undefined && s.tong !== null)
            .map(s => s.tong);
    }
    cauSap(arr) {
        if (arr.length < 2) return null;
        let length = 1;
        for (let i = 1; i < arr.length; i++) {
            if (arr[i] === arr[0]) length++;
            else break;
        }
        if (length >= 2 && length <= 5) {
            return { pred: arr[0], conf: 72, type: "Đu Bệt", reason: `Bệt ${length} phiên` };
        }
        if (length >= 6) {
            return { pred: arr[0] === "TAI" ? "XIU" : "TAI", conf: 80, type: "Bẻ Bệt Rồng", reason: `Bệt dài ${length} → hồi` };
        }
        return null;
    }
    cauNoi(arr) {
        if (arr.length < 5) return null;
        for (let i = 0; i < 4; i++) {
            if (arr[i] === arr[i + 1]) return null;
        }
        return { pred: arr[0] === "TAI" ? "XIU" : "TAI", conf: 82, type: "Cầu Nối 1-1", reason: "Nhịp 1-1 ổn định" };
    }
    cauDoi(arr) {
        if (arr.length < 4) return null;
        if (arr[0] === arr[1] && arr[2] === arr[3] && arr[0] !== arr[2]) {
            return { pred: arr[2], conf: 78, type: "Cầu 2-2", reason: "AABB → B" };
        }
        if (arr.length >= 6 && arr[0] === arr[1] && arr[1] === arr[2] && 
            arr[3] === arr[4] && arr[4] === arr[5] && arr[0] !== arr[3]) {
            return { pred: arr[3], conf: 80, type: "Cầu 3-3", reason: "AAABBB → B" };
        }
        return null;
    }
    cauGay(arr) {
        if (arr.length >= 5 && arr[0] === arr[1] && arr[1] === arr[2] && arr[2] !== arr[3] && arr[3] === arr[4]) {
            return { pred: arr[3], conf: 74, type: "Gãy 3-2", reason: "AAABB → B" };
        }
        if (arr.length >= 5 && arr[0] === arr[1] && arr[1] !== arr[2] && arr[2] === arr[3] && arr[3] === arr[4]) {
            return { pred: arr[2], conf: 74, type: "Gãy 2-3", reason: "AABBB → B" };
        }
        if (arr.length >= 4 && arr[0] !== arr[1] && arr[1] === arr[2] && arr[2] !== arr[3] && arr[0] === arr[3]) {
            return { pred: arr[1], conf: 72, type: "Gãy 1-2-1", reason: "ABBA → B" };
        }
        return null;
    }
    phatHienMauLap(arr) {
        if (arr.length < 6) return null;
        for (let len = 2; len <= 4; len++) {
            let pattern = arr.slice(0, len);
            for (let i = len; i < arr.length - len; i++) {
                let sub = arr.slice(i, i + len);
                if (JSON.stringify(sub) === JSON.stringify(pattern) && arr[i - 1]) {
                    return { pred: arr[i - 1], conf: 88, type: "Mẫu Lặp", reason: `Mẫu "${pattern.join(',')}"` };
                }
            }
        }
        return null;
    }
    duDoanVi() {
        const points = this._points();
        if (points.length < 5) return null;
        const last = points[0], prev = points[1];
        const slice = points.slice(0, 5);
        const avg = slice.reduce((a, b) => a + b, 0) / slice.length;
        if (last >= 15) return { pred: "XIU", conf: 75, type: "Vị cực đại", reason: `Điểm ${last} → hồi Xỉu` };
        if (last <= 5) return { pred: "TAI", conf: 75, type: "Vị cực tiểu", reason: `Điểm ${last} → hồi Tài` };
        if (avg > 11 && last > prev) return { pred: "XIU", conf: 68, type: "Vị bão hòa", reason: "Đà tăng chạm ngưỡng" };
        if (avg < 10 && last < prev) return { pred: "TAI", conf: 68, type: "Vị cạn kiệt", reason: "Đà giảm chạm đáy" };
        if (avg >= 11 && last >= 11 && last <= 13) return { pred: "TAI", conf: 65, type: "Vị ổn định", reason: "Duy trì Tài nhẹ" };
        if (avg <= 9 && last >= 7 && last <= 9) return { pred: "XIU", conf: 65, type: "Vị ổn định", reason: "Duy trì Xỉu nhẹ" };
        return null;
    }
    tongHopDuDoan() {
        const arr = this._arr();
        if (arr.length < 2) return null;
        return this.phatHienMauLap(arr) || this.cauNoi(arr) || this.cauDoi(arr) ||
               this.cauGay(arr) || this.cauSap(arr) || this.duDoanVi() ||
               { pred: arr[0], conf: 55, type: "Theo", reason: "Bám phiên cuối" };
    }
    apDungDaoChieu(p) {
        if (!p || this.history.length < 1) return p;
        const currentResult = this._arr()[0];
        if (this.error_streak >= 2 && this.last_prediction && this.last_prediction !== currentResult) {
            return {
                ...p,
                pred: p.pred === "TAI" ? "XIU" : "TAI",
                conf: Math.min(88, p.conf + 10),
                reason: `🔄 Đảo: ${p.reason}`
            };
        }
        return p;
    }
    predict(data) {
        this.loadData(data);
        let result = this.tongHopDuDoan();
        if (result) result = this.apDungDaoChieu(result);
        else result = { pred: this._arr()[0] || "TAI", conf: 50, type: "Theo", reason: "Không đủ dữ liệu" };
        
        this.last_prediction = result.pred;
        return result;
    }
    updateStatus(actual) {
        if (this.last_prediction) {
            const a = actual.toUpperCase().replace('XỈU', 'XIU').replace('TÀI', 'TAI');
            if (this.last_prediction === a) this.error_streak = 0;
            else this.error_streak++;
        }
    }
}
const predictor = new TX_LogicPen_V4();
// --- Helper Functions ---
function loadHistory() {
    try {
        if (fs.existsSync(DATA_FILE)) {
            const content = fs.readFileSync(DATA_FILE, 'utf-8');
            const data = JSON.parse(content);
            return data.history || [];
        }
    } catch (e) {
        console.error(`Lỗi đọc file: ${e.message}`);
    }
    return [];
}
function saveHistory(history) {
    const dir = path.dirname(DATA_FILE);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    
    // Giới hạn lưu trữ tối đa MAX_STORAGE phiên
    const limitedHistory = history.slice(-MAX_STORAGE);
    
    fs.writeFileSync(DATA_FILE, JSON.stringify({ 
        history: limitedHistory,
        total_sessions: limitedHistory.length,
        max_storage: MAX_STORAGE,
        last_updated: vnNow()
    }, null, 2));
    
    console.log(`💾 Đã lưu ${limitedHistory.length}/${MAX_STORAGE} phiên dữ liệu`);
}
function saveStatsFile() {
    const dir = path.dirname(STATS_FILE);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(STATS_FILE, JSON.stringify({
        ...stats,
        total_predictions_made: stats.total_predictions_made,
        max_predictions: MAX_PREDICTIONS,
        min_data_required: MIN_DATA_FOR_PREDICTION,
        max_storage: MAX_STORAGE,
        prediction_started: stats.prediction_started,
        last_updated: vnNow()
    }, null, 2));
}
function autoVerify(history) {
    if (stats.last_prediction && history.length > 0) {
        const lp = stats.last_prediction;
        const latest = history[history.length - 1];
        
        if (latest.phien === lp.phien) {
            const actual = latest.ket_qua || '';
            if (actual) {
                stats.total++;
                const a = actual.toUpperCase().replace('XỈU', 'XIU').replace('TÀI', 'TAI');
                const p = lp.prediction.toUpperCase().replace('XỈU', 'XIU').replace('TÀI', 'TAI');
                const ok = p === a;
                if (ok) stats.correct++;
                else stats.wrong++;
                predictor.updateStatus(actual);
                stats.history.push({
                    phien: latest.phien,
                    prediction: lp.prediction,
                    actual: actual,
                    confidence: lp.confidence,
                    correct: ok,
                    timestamp: vnNow()
                });
                if (stats.history.length > 500) stats.history = stats.history.slice(-500);
                
                const acc = ((stats.correct / Math.max(stats.total, 1)) * 100).toFixed(1);
                console.log(`🔍 VERIFY #${latest.phien}: ${ok ? '✅ ĐÚNG' : '❌ SAI'} | Tỷ lệ: ${acc}% (${stats.correct}/${stats.total})`);
                
                stats.last_prediction = null;
                saveStatsFile();
            }
        }
    }
}
function autoPredict(history) {
    // Chỉ dự đoán nếu đã có đủ dữ liệu
    if (!stats.prediction_started) {
        if (history.length >= MIN_DATA_FOR_PREDICTION) {
            stats.prediction_started = true;
            console.log(`\n🎉 ĐÃ ĐỦ ${MIN_DATA_FOR_PREDICTION} PHIÊN DỮ LIỆU! BẮT ĐẦU DỰ ĐOÁN...\n`);
        } else {
            const remaining = MIN_DATA_FOR_PREDICTION - history.length;
            console.log(`⏳ Đang thu thập dữ liệu: ${history.length}/${MIN_DATA_FOR_PREDICTION} phiên. Cần thêm ${remaining} phiên nữa để bắt đầu dự đoán.`);
            return;
        }
    }
    
    // Kiểm tra giới hạn dự đoán
    if (stats.total_predictions_made >= MAX_PREDICTIONS) {
        console.log(`🏁 Đã đạt giới hạn ${MAX_PREDICTIONS} dự đoán. Ngừng dự đoán mới.`);
        return;
    }
    
    if (history.length >= 5) {
        try {
            const r = predictor.predict(history);
            const cur = history[history.length - 1];
            let ph = cur.phien || 0;
            if (typeof ph === 'string') {
                const cleaned = ph.replace('#', '');
                ph = !isNaN(cleaned) ? parseInt(cleaned) : 0;
            }
            
            const nextPhien = ph + 1;
            stats.last_prediction = { 
                phien: nextPhien, 
                prediction: r.pred, 
                confidence: r.conf 
            };
            // ✅ Lưu đầy đủ thông tin để trả qua API /sun
            stats.last_prediction_full = {
                phien: nextPhien,
                du_doan: r.pred,
                do_tin_cay: r.conf + "%",
                loai_cau: r.type,
                ly_do: r.reason,
                error_streak_hien_tai: predictor.error_streak,
                thoi_gian: vnNow()
            };
            stats.total_predictions_made++;
            
            const remaining = MAX_PREDICTIONS - stats.total_predictions_made;
            console.log(`🎯 DỰ ĐOÁN #${nextPhien}: ${r.pred} | Độ tin cậy: ${r.conf}% | ${r.type} | Còn: ${remaining}/${MAX_PREDICTIONS}`);
            
            saveStatsFile();
        } catch (e) {
            console.error(`Lỗi dự đoán: ${e.message}`);
        }
    }
}
function safeInt(v, d = 0) {
    const parsed = parseInt(v);
    return isNaN(parsed) ? d : parsed;
}

// ✅ ==== THÊM MỚI: MÁY CHỦ HTTP LẤY KẾT QUẢ DỰ ĐOÁN TẠI /sun ====
let currentHistoryRef = []; // Giữ tham chiếu dữ liệu mới nhất
const predictionServer = http.createServer((req, res) => {
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    res.setHeader('Access-Control-Allow-Origin', '*');

    if (req.method === 'GET' && req.url === '/sun') {
        const tyLeDung = stats.total > 0 
            ? ((stats.correct / stats.total) * 100).toFixed(2) + "%" 
            : "Chưa có dữ liệu";

        const ketQuaTraVe = {
            trang_thai: "hoat_dong",
            thoi_gian: vnNow(),
            du_lieu_da_thu_thap: currentHistoryRef.length,
            yeu_cau_toi_thieu: MIN_DATA_FOR_PREDICTION,
            da_san_sang_du_doan: stats.prediction_started,
            tong_du_doan_da_tao: stats.total_predictions_made,
            tong_kiem_tra: stats.total,
            dung: stats.correct,
            sai: stats.wrong,
            ty_le_dung: tyLeDung,
            du_doan_phan_tiep_theo: stats.last_prediction_full || "Chưa có dự đoán nào, chờ đủ dữ liệu",
            ket_qua_phan_cuoi: currentHistoryRef.length > 0 ? currentHistoryRef[currentHistoryRef.length - 1] : null,
            chuoi_sai_lien_tiep: predictor.error_streak
        };
        res.writeHead(200);
        res.end(JSON.stringify(ketQuaTraVe, null, 2));
        return;
    }

    res.writeHead(404);
    res.end(JSON.stringify({ loi: "Đường dẫn không tồn tại, vui lòng gọi /sun" }));
});

predictionServer.listen(API_PORT, () => {
    console.log(`🌐 API lấy dự đoán đã mở tại: http://localhost:${API_PORT}/sun`);
});
// ✅ ==== KẾT THÚC PHẦN THÊM MỚI ====

// --- Main Collector ---
async function collect() {
    console.log("🚀 SUNWIN TX COLLECTOR - KHỞI ĐỘNG");
    console.log("═══════════════════════════════════════════");
    console.log(`📊 Yêu cầu dữ liệu tối thiểu: ${MIN_DATA_FOR_PREDICTION.toLocaleString()} phiên`);
    console.log(`🎯 Giới hạn dự đoán: ${MAX_PREDICTIONS.toLocaleString()} phiên`);
    console.log(`💾 Giới hạn lưu trữ: ${MAX_STORAGE.toLocaleString()} phiên`);
    console.log("═══════════════════════════════════════════\n");
    
    // Tải dữ liệu hiện có
    let history = loadHistory();
    currentHistoryRef = history; // ✅ Gán tham chiếu cho API
    console.log(`📚 Đã tải ${history.length.toLocaleString()} phiên dữ liệu hiện có`);
    
    // Khôi phục stats
    try {
        if (fs.existsSync(STATS_FILE)) {
            const savedStats = JSON.parse(fs.readFileSync(STATS_FILE, 'utf-8'));
            stats = { ...stats, ...savedStats };
            if (stats.prediction_started) {
                console.log(`📈 Đã dự đoán ${stats.total_predictions_made.toLocaleString()}/${MAX_PREDICTIONS.toLocaleString()} phiên`);
                console.log(`📊 Tỷ lệ đúng: ${((stats.correct/Math.max(stats.total,1))*100).toFixed(1)}% (${stats.correct}/${stats.total})\n`);
            }
        }
    } catch (e) {}
    
    // Vòng lặp chính
    while (true) {
        try {
            const response = await axios.get(API_URL, { timeout: 15000 });
            if (response.status === 200) {
                const apiData = response.data.data || [];
                if (apiData.length > 0) {
                    let existing = new Set(history.map(h => h.phien));
                    let newSessions = [];
                    for (const item of apiData) {
                        const ph = safeInt(item.Phien);
                        if (ph <= 0 || existing.has(ph)) continue;
                        const newItem = {
                            phien: ph,
                            ket_qua: String(item.Ket_qua || ""),
                            tong: safeInt(item.Tong),
                            xuc_xac_1: safeInt(item.Xuc_xac_1),
                            xuc_xac_2: safeInt(item.Xuc_xac_2),
                            xuc_xac_3: safeInt(item.Xuc_xac_3)
                        };
                        
                        history.push(newItem);
                        existing.add(ph);
                        newSessions.push(newItem);
                    }
                    if (newSessions.length > 0) {
                        // Giới hạn lưu trữ
                        if (history.length > MAX_STORAGE) {
                            history = history.slice(-MAX_STORAGE);
                        }
                        
                        history.sort((a, b) => a.phien - b.phien);
                        currentHistoryRef = history; // ✅ Cập nhật dữ liệu mới nhất cho API
                        saveHistory(history);
                        
                        const latest = history[history.length - 1];
                        const progress = `${history.length.toLocaleString()}/${MIN_DATA_FOR_PREDICTION.toLocaleString()}`;
                        console.log(`🎲 KQ #${latest.phien}: ${latest.ket_qua} | [${latest.xuc_xac_1},${latest.xuc_xac_2},${latest.xuc_xac_3}] = ${latest.tong} | Tiến độ: ${progress}`);
                        
                        autoVerify(history);
                        autoPredict(history);
                        
                        // Kiểm tra nếu đã đạt giới hạn dự đoán
                        if (stats.prediction_started && stats.total_predictions_made >= MAX_PREDICTIONS) {
                            console.log("\n🎯 ĐÃ ĐẠT GIỚI HẠN DỰ ĐOÁN!");
                            console.log(`📊 THỐNG KÊ CUỐI CÙNG:`);
                            console.log(`   Tổng dự đoán: ${stats.total_predictions_made}`);
                            console.log(`   Đúng: ${stats.correct}`);
                            console.log(`   Sai: ${stats.wrong}`);
                            console.log(`   Tỷ lệ: ${((stats.correct/Math.max(stats.total,1))*100).toFixed(2)}%`);
                            console.log("\n🛑 Kết thúc chương trình...");
                            process.exit(0);
                        }
                    }
                }
            }
        } catch (e) {
            console.error(`❌ Lỗi: ${e.message}`);
        }
        await new Promise(resolve => setTimeout(resolve, 3000));
    }
}
// Xử lý tắt chương trình
process.on('SIGINT', () => {
    console.log("\n🛑 Đang dừng chương trình...");
    saveStatsFile();
    predictionServer.close();
    console.log("✅ Đã lưu thống kê & đóng cổng API!");
    process.exit();
});
// Chạy Collector
collect().catch(console.error);