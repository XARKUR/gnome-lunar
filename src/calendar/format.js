// SPDX-License-Identifier: GPL-3.0-or-later
const MONTHS = ['正', '二', '三', '四', '五', '六', '七', '八', '九', '十', '冬', '腊'];
const DIGITS = '一二三四五六七八九';
const HOURS = '子丑寅卯辰巳午未申酉戌亥';
export function dayName(day) {
    if (!Number.isInteger(day) || day < 1 || day > 30) return '';
    if (day === 10) return '初十';
    if (day === 20) return '二十';
    if (day === 30) return '三十';
    return ['初', '十', '廿'][Math.floor(day / 10)] + DIGITS[(day - 1) % 10];
}
export function monthName(info) {
    return info ? `${info.leap ? '闰' : ''}${MONTHS[info.month - 1]}月` : '';
}
export function dateText(info) { return info ? monthName(info) + dayName(info.day) : ''; }
export function hourText(date) { return `${HOURS[Math.floor((date.getHours() + 1) / 2) % 12]}时`; }
export function annotation(info, {festivals = true, solarTerms = true} = {}) {
    if (!info) return '';
    if (festivals && info.festivals.length) return info.festivals[0];
    if (solarTerms && info.solarTerm) return info.solarTerm;
    return info.day === 1 ? monthName(info) : dayName(info.day);
}
export function detailsText(info, {festivals = true, solarTerms = true} = {}) {
    if (!info) return '';
    return [...(festivals ? info.festivals : []), ...(solarTerms && info.solarTerm ? [info.solarTerm] : [])].join(' · ');
}
