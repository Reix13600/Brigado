export interface Holiday {
  nameFr: string;
  nameEn: string;
}

// Meeus/Jones/Butcher algorithm to calculate Gregorian Easter
export function getEasterDate(year: number): Date {
  const a = year % 19;
  const b = Math.floor(year / 100);
  const c = year % 100;
  const d = Math.floor(b / 4);
  const e = b % 4;
  const f = Math.floor((b + 8) / 25);
  const g = Math.floor((b - f + 1) / 3);
  const h = (19 * a + b - d - g + 15) % 30;
  const i = Math.floor(c / 4);
  const k = c % 4;
  const l = (32 + 2 * e + 2 * i - h - k) % 7;
  const m = Math.floor((a + 11 * h + 22 * l) / 451);
  const month = Math.floor((h + l - 7 * m + 114) / 31); // 3 = March, 4 = April
  const day = ((h + l - 7 * m + 114) % 31) + 1;
  
  return new Date(year, month - 1, day);
}

// Create a formatted date string YYYY-MM-DD
function formatDate(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

export function getFrenchHolidays(year: number): Record<string, Holiday> {
  const holidays: Record<string, Holiday> = {};

  // Fixed holidays
  holidays[`${year}-01-01`] = { nameFr: "Jour de l'An", nameEn: "New Year's Day" };
  holidays[`${year}-05-01`] = { nameFr: "Fête du Travail", nameEn: "Labor Day" };
  holidays[`${year}-05-08`] = { nameFr: "Victoire 1945", nameEn: "WWII Victory Day" };
  holidays[`${year}-07-14`] = { nameFr: "Fête Nationale", nameEn: "Bastille Day" };
  holidays[`${year}-08-15`] = { nameFr: "Assomption", nameEn: "Assumption Day" };
  holidays[`${year}-11-01`] = { nameFr: "Toussaint", nameEn: "All Saints' Day" };
  holidays[`${year}-11-11`] = { nameFr: "Armistice 1918", nameEn: "Armistice Day" };
  holidays[`${year}-12-25`] = { nameFr: "Noël", nameEn: "Christmas Day" };

  // Easter-based holidays
  const easter = getEasterDate(year);
  
  // Easter Monday = Easter + 1 day
  const easterMonday = new Date(easter);
  easterMonday.setDate(easter.getDate() + 1);
  holidays[formatDate(easterMonday)] = { nameFr: "Lundi de Pâques", nameEn: "Easter Monday" };

  // Ascension = Easter + 39 days
  const ascension = new Date(easter);
  ascension.setDate(easter.getDate() + 39);
  holidays[formatDate(ascension)] = { nameFr: "Ascension", nameEn: "Ascension Day" };

  // Pentecost Monday = Easter + 50 days
  const pentecostMonday = new Date(easter);
  pentecostMonday.setDate(easter.getDate() + 50);
  holidays[formatDate(pentecostMonday)] = { nameFr: "Lundi de Pentecôte", nameEn: "Pentecost Monday" };

  return holidays;
}

// Global helper to check if a date is a French holiday
export function getFrenchHoliday(dateStr: string): Holiday | null {
  if (!dateStr) return null;
  const parts = dateStr.split("-");
  if (parts.length < 3) return null;
  const year = parseInt(parts[0], 10);
  if (isNaN(year)) return null;
  
  const yearHolidays = getFrenchHolidays(year);
  return yearHolidays[dateStr] || null;
}
