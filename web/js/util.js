/**
 * Small pure helpers shared across the app.
 * `relativeTime` reads the i18n dictionary from the global BobigoI18n.
 */

export function formatFileSize(bytes) {
    if (!bytes || bytes === 0) return "0 B";
    const k = 1024;
    const sizes = ["B", "KB", "MB", "GB"];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + " " + sizes[i];
}

export function downloadFile(content, fileName, contentType) {
    const a = document.createElement("a");
    const file = new Blob([content], { type: contentType });
    a.href = URL.createObjectURL(file);
    a.download = fileName;
    a.click();
    URL.revokeObjectURL(a.href);
}

export function refineSearchQuery(text) {
    let q = String(text || "").replace(/```[\s\S]*?```/g, " ").replace(/\s+/g, " ").trim();
    const sentence = q.split(/(?<=[.!?。？！])\s+/)[0] || q;
    q = sentence.length > 160 ? sentence.slice(0, 160) : sentence;
    return q;
}

export function relativeTime(iso, lang = "vi") {
    if (!iso) return "";
    const then = new Date(iso).getTime();
    if (Number.isNaN(then)) return "";
    const delta = Math.max(0, Date.now() - then);
    const min = Math.floor(delta / 60000);
    const i18n = window.BobigoI18n;
    if (min < 1) return i18n ? i18n.t(lang, "justNow") : "Vừa xong";
    if (min < 60) return `${min}${i18n ? i18n.t(lang, "minAgo") : " phút trước"}`;
    const hr = Math.floor(min / 60);
    if (hr < 24) return `${hr}${i18n ? i18n.t(lang, "hrAgo") : " giờ trước"}`;
    const day = Math.floor(hr / 24);
    if (day < 7) return `${day}${i18n ? i18n.t(lang, "dayAgo") : " ngày trước"}`;
    return new Date(iso).toLocaleDateString("vi-VN");
}
