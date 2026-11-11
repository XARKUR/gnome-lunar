// SPDX-License-Identifier: GPL-3.0-or-later
// Project-owned civil-date API over the credited ChineseCalendar astronomy data.
import {calDataYear} from '../vendor/ChineseCalendar/calendar.js';

export const MIN_YEAR = 1734;
export const MAX_YEAR = 2200;
const TERMS = ['小寒', '大寒', '立春', '雨水', '惊蛰', '春分',
    '清明', '谷雨', '立夏', '小满', '芒种', '夏至',
    '小暑', '大暑', '立秋', '处暑', '白露', '秋分',
    '寒露', '霜降', '立冬', '小雪', '大雪', '冬至'];
const LUNAR_FESTIVALS = new Map([
    ['1-1', '春节'], ['1-15', '元宵节'], ['2-2', '龙抬头'],
    ['5-5', '端午节'], ['7-7', '七夕'], ['7-15', '中元节'],
    ['8-15', '中秋节'], ['9-9', '重阳节'], ['12-8', '腊八节'],
]);
const SOLAR_FESTIVALS = new Map([['1-1', '元旦'], ['5-1', '劳动节'], ['10-1', '国庆节']]);
const STEMS = '甲乙丙丁戊己庚辛壬癸';
const BRANCHES = '子丑寅卯辰巳午未申酉戌亥';
const ANIMALS = '鼠牛虎兔龙蛇马羊猴鸡狗猪';
const mod = (n, d) => ((n % d) + d) % d;

export class LunarCalendar {
    constructor() { this._years = new Map(); }
    clear() { this._years.clear(); }
    _year(year) {
        if (!this._years.has(year)) {
            // Keep navigation across centuries from accumulating cached tables.
            if (this._years.size === 3)
                this._years.delete(this._years.keys().next().value);
            this._years.set(year, calDataYear(year, {region: 'default'}));
        }
        return this._years.get(year);
    }
    forDate(date) {
        if (!date || !Number.isFinite(date.getTime())) return null;
        const year = date.getFullYear();
        if (year < MIN_YEAR || year > MAX_YEAR) return null;
        const month = date.getMonth();
        const day = date.getDate();
        const data = this._year(year);
        const ordinal = data.mday[month] + day;
        let index = data.cmonthDate.length - 1;
        while (index > 0 && data.cmonthDate[index] > ordinal) index--;
        const lunarMonth = Math.abs(data.cmonthNum[index]);
        const lunarDay = ordinal - data.cmonthDate[index] + 1;
        const leap = data.cmonthNum[index] < 0;
        const lunarYear = year - 1 + data.cmonthXiaYear[index];
        const monthLength = 29 + data.cmonthLong[index];
        const termIndex = data.solar.findIndex(value => Math.floor(value) === ordinal);
        const festivals = [];
        const fixed = SOLAR_FESTIVALS.get(`${month + 1}-${day}`);
        const lunar = !leap && LUNAR_FESTIVALS.get(`${lunarMonth}-${lunarDay}`);
        if (fixed) festivals.push(fixed);
        if (lunar) festivals.push(lunar);
        if (!leap && lunarMonth === 12 && lunarDay === monthLength) festivals.push('除夕');
        return Object.freeze({
            year: lunarYear, month: lunarMonth, day: lunarDay, leap, monthLength,
            festivals: Object.freeze(festivals), solarTerm: termIndex < 0 ? '' : TERMS[termIndex],
            ganzhiYear: STEMS[mod(lunarYear - 4, 10)] + BRANCHES[mod(lunarYear - 4, 12)],
            zodiac: ANIMALS[mod(lunarYear - 4, 12)],
        });
    }
}
