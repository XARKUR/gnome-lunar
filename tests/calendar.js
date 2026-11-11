import {LunarCalendar} from '../src/calendar/engine.js';
import {dateText, dayName, hourText, annotation, detailsText} from '../src/calendar/format.js';
const engine = new LunarCalendar();
function assert(value, message) { if (!value) throw new Error(message); }
for (const [y, m, d, lm, ld, leap] of [
    [2024, 2, 10, 1, 1, false], [2025, 1, 29, 1, 1, false],
    [2026, 2, 17, 1, 1, false], [2026, 9, 25, 8, 15, false],
    [2025, 7, 25, 6, 1, true], [2027, 2, 6, 1, 1, false], [2027, 2, 15, 1, 10, false],
]) {
    const info = engine.forDate(new Date(y, m - 1, d, 12));
    assert(info.month === lm && info.day === ld && info.leap === leap, `Wrong lunar date ${y}-${m}-${d}`);
}
const cny = engine.forDate(new Date(2026, 1, 17));
assert(cny.year === 2026 && cny.ganzhiYear === '丙午' && cny.zodiac === '马', 'Wrong lunar year');
assert(dateText(cny) === '正月初一' && annotation(cny) === '春节', 'Wrong CNY formatting');
assert(annotation(cny, {festivals: false}) === '正月', 'Festival toggle ignored');
assert(detailsText(cny, {festivals: false, solarTerms: false}) === '', 'Hidden event leaked');
assert(engine.forDate(new Date(2026, 1, 16)).festivals.includes('除夕'), 'Missing CNY eve');
assert(engine.forDate(new Date(2025, 0, 28)).festivals.includes('除夕'), 'Missing 29-day CNY eve');
assert(engine.forDate(new Date(2026, 0, 1)).year === 2025, 'January lunar year rollover');
assert(dateText(engine.forDate(new Date(2025, 6, 25))) === '闰六月初一', 'Leap month formatting');
assert(dayName(10) === '初十' && dayName(20) === '二十' && dayName(30) === '三十', 'Day names');
assert(hourText(new Date(2026, 0, 1, 23)) === '子时' && hourText(new Date(2026, 0, 1, 1)) === '丑时', 'Two-hour boundaries');
const expectedTerms = [[2026, 2, 4, '立春'], [2026, 4, 5, '清明'], [2026, 12, 22, '冬至']];
for (const [y, m, d, term] of expectedTerms)
    assert(engine.forDate(new Date(y, m - 1, d)).solarTerm === term, `Wrong solar term ${term}`);
// Old ICU is inaccurate around February 2027. Those fixed cases above use HKO.
const oracle = new Intl.DateTimeFormat('en-u-ca-chinese', {month: 'numeric', day: 'numeric'});
let comparisons = 0;
for (let year = 2020; year <= 2026; year++) {
    for (let month = 0; month < 12; month++) {
        const date = new Date(year, month, 15, 12);
        const parts = oracle.formatToParts(date);
        const actual = engine.forDate(date);
        assert(actual.month === parseInt(parts.find(p => p.type === 'month').value) &&
            actual.day === parseInt(parts.find(p => p.type === 'day').value), `ICU mismatch ${date}`);
        comparisons++;
    }
}
for (const year of [1734, 1900, 2000, 2025, 2026, 2027, 2100, 2200]) {
    let termCount = 0;
    for (let date = new Date(year, 0, 1, 12); date.getFullYear() === year; date.setDate(date.getDate() + 1)) {
        const info = engine.forDate(date);
        assert(info.month >= 1 && info.month <= 12 && info.day >= 1 && info.day <= info.monthLength, `Invalid calendar date ${date}`);
        if (info.solarTerm) termCount++;
        if (info.leap) assert(!info.festivals.includes('端午节') && !info.festivals.includes('中秋节'), 'Leap month repeated lunar festival');
    }
    assert(termCount === 24, `${year}: expected 24 solar terms, got ${termCount}`);
}
assert(engine.forDate(new Date(1733, 0, 1)) === null && engine.forDate(new Date(2201, 0, 1)) === null, 'Range fallback');
assert(engine.forDate(new Date(NaN)) === null, 'Invalid date fallback');
assert(engine._years.size <= 3, 'Year cache grew without bound');
engine.clear();
assert(engine._years.size === 0, 'Calendar cache not released');
console.log(`Calendar: fixed HKO dates, leap month, eve, solar terms, 8 complete years and ${comparisons} ICU comparisons passed.`);
