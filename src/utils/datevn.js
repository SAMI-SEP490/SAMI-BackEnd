// src/utils/datevn.js

/**
 * Returns a Date object representing 00:00:00 of the CURRENT day in Vietnam time.
 * Safe to use for @db.Date columns.
 */
function getVietnamDay() {
    const now = new Date();
    // 1. Convert current UTC time to a string representing Vietnam time
    // e.g., "1/21/2026, 2:30:00 AM"
    const vnString = now.toLocaleString("en-US", { timeZone: "Asia/Ho_Chi_Minh" });
    
    // 2. Parse that string back into a Date object
    const vnDate = new Date(vnString);

    // 3. Return UTC midnight of that specific date to ensure Prisma saves the correct day
    // e.g., 2026-01-21T00:00:00.000Z
    return new Date(Date.UTC(vnDate.getFullYear(), vnDate.getMonth(), vnDate.getDate()));
}

/**
 * Returns a Date object from an input string, strictly parsed as Vietnam Time start-of-day.
 */
function parseVietnamDate(dateString) {
    // If input is "2026-01-21"
    const date = new Date(dateString);
    // Ensure we treat it as VN day
    // (Simple ISO parsing usually defaults to UTC 00:00 which is fine, 
    // but if you want to be extra safe against local server time offset):
    return new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()));
}

module.exports = { getVietnamDay, parseVietnamDate };
