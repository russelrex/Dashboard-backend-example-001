/**
 * File: timezoneUtils.ts
 * Purpose: Backend timezone conversion utilities (no external dependencies)
 * Author: LPai Team
 * Last Modified: 2025-10-14
 * Location: /lpai-backend/src/utils/timezoneUtils.ts
 */

// Timezone offset mappings (in minutes from UTC)
// This is a simplified version - in production you'd want a more comprehensive list
const TIMEZONE_OFFSETS: Record<string, number> = {
    // US Timezones
    'America/New_York': -300,    // EST/EDT (UTC-5/-4)
    'America/Chicago': -360,      // CST/CDT (UTC-6/-5)
    'America/Denver': -420,       // MST/MDT (UTC-7/-6)
    'America/Phoenix': -420,      // MST (no DST)
    'America/Los_Angeles': -480,  // PST/PDT (UTC-8/-7)
    'America/Anchorage': -540,    // AKST/AKDT (UTC-9/-8)
    'Pacific/Honolulu': -600,     // HST (UTC-10, no DST)
    
    // Other common timezones
    'UTC': 0,
    'Europe/London': 0,           // GMT/BST (UTC+0/+1)
    'Europe/Paris': 60,           // CET/CEST (UTC+1/+2)
    'Asia/Dubai': 240,            // GST (UTC+4)
    'Asia/Kolkata': 330,          // IST (UTC+5:30)
    'Asia/Shanghai': 480,         // CST (UTC+8)
    'Asia/Tokyo': 540,            // JST (UTC+9)
    'Australia/Sydney': 600,      // AEST/AEDT (UTC+10/+11)
  };
  
  // Timezone abbreviations for display
  const TIMEZONE_ABBR: Record<string, string> = {
    'America/New_York': 'ET',
    'America/Chicago': 'CT',
    'America/Denver': 'MT',
    'America/Phoenix': 'MST',
    'America/Los_Angeles': 'PT',
    'America/Anchorage': 'AKT',
    'Pacific/Honolulu': 'HST',
    'UTC': 'UTC',
    'Europe/London': 'GMT',
    'Europe/Paris': 'CET',
    'Asia/Dubai': 'GST',
    'Asia/Kolkata': 'IST',
    'Asia/Shanghai': 'CST',
    'Asia/Tokyo': 'JST',
    'Australia/Sydney': 'AEST',
  };
  
  /**
   * Check if a date falls within Daylight Saving Time
   * (This is a simplified check for US timezones)
   */
  function isDST(date: Date, timezone: string): boolean {
    if (!timezone.startsWith('America/') || timezone === 'America/Phoenix') {
      return false; // No DST
    }
    
    const year = date.getFullYear();
    const month = date.getMonth();
    const day = date.getDate();
    
    // DST in US: Second Sunday in March to First Sunday in November
    // This is a simplified check
    if (month < 2 || month > 10) return false; // Jan-Feb, Dec
    if (month > 2 && month < 10) return true;  // Apr-Oct
    
    // For March and November, would need more complex logic
    // For now, we'll use a simple heuristic
    return month >= 3 && month < 11;
  }
  
  /**
   * Get the offset in minutes for a timezone at a specific date
   */
  function getTimezoneOffset(timezone: string, date: Date): number {
    const baseOffset = TIMEZONE_OFFSETS[timezone];
    
    if (baseOffset === undefined) {
      console.warn(`Unknown timezone: ${timezone}, using UTC`);
      return 0;
    }
    
    // Adjust for DST if applicable
    if (isDST(date, timezone)) {
      return baseOffset + 60; // Add 1 hour for DST
    }
    
    return baseOffset;
  }
  
  /**
   * Convert a UTC date to a specific timezone
   */
  export function convertToTimezone(utcDate: Date | string, timezone: string): Date {
    const date = new Date(utcDate);
    
    // Get the timezone offset in minutes
    const offsetMinutes = getTimezoneOffset(timezone, date);
    
    // Convert UTC to target timezone
    // Note: JavaScript Date always stores in UTC internally
    const localTime = new Date(date.getTime() + (offsetMinutes * 60 * 1000));
    
    return localTime;
  }
  
  /**
   * Format a date with timezone abbreviation
   * @param date - Date to format (should already be converted to target timezone)
   * @param timezone - Timezone string (e.g., 'America/Denver')
   * @param format12h - Use 12-hour format (default: true)
   * @returns Formatted time string like "9:30 AM MST"
   */
  export function formatTimeWithTimezone(
    date: Date | string, 
    timezone: string = 'America/Denver',
    format12h: boolean = true
  ): string {
    const localDate = convertToTimezone(date, timezone);
    
    const hours = localDate.getUTCHours();
    const minutes = localDate.getUTCMinutes();
    
    let formattedTime: string;
    
    if (format12h) {
      const period = hours >= 12 ? 'PM' : 'AM';
      const displayHours = hours % 12 || 12; // Convert 0 to 12
      const displayMinutes = minutes.toString().padStart(2, '0');
      formattedTime = `${displayHours}:${displayMinutes} ${period}`;
    } else {
      const displayHours = hours.toString().padStart(2, '0');
      const displayMinutes = minutes.toString().padStart(2, '0');
      formattedTime = `${displayHours}:${displayMinutes}`;
    }
    
    // Add timezone abbreviation
    const tzAbbr = TIMEZONE_ABBR[timezone] || timezone;
    return `${formattedTime} ${tzAbbr}`;
  }
  
  /**
   * Format a full date with timezone
   * @param date - Date to format
   * @param timezone - Timezone string
   * @returns Formatted date like "Monday, January 15, 2025"
   */
  export function formatDateWithTimezone(
    date: Date | string,
    timezone: string = 'America/Denver'
  ): string {
    const localDate = convertToTimezone(date, timezone);
    
    const days = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
    const months = [
      'January', 'February', 'March', 'April', 'May', 'June',
      'July', 'August', 'September', 'October', 'November', 'December'
    ];
    
    const dayName = days[localDate.getUTCDay()];
    const monthName = months[localDate.getUTCMonth()];
    const dayNum = localDate.getUTCDate();
    const year = localDate.getUTCFullYear();
    
    return `${dayName}, ${monthName} ${dayNum}, ${year}`;
  }
  
  /**
   * Get timezone in priority order: contact → user → location
   * @param contact - Contact document (may have timezone field)
   * @param user - User document (may have preferences.timezone)
   * @param location - Location document (may have timezone or settings.timezone)
   * @returns Timezone string or 'America/Denver' as fallback
   */
  export function getTimezoneWithPriority(
    contact?: any,
    user?: any,
    location?: any
  ): string {
    // Priority 1: Contact timezone
    if (contact?.timezone && contact.timezone.trim() !== '') {
      return contact.timezone;
    }
    
    // Priority 2: User preferences timezone
    if (user?.preferences?.timezone) {
      return user.preferences.timezone;
    }
    
    // Priority 3: Location timezone
    if (location?.timezone) {
      return location.timezone;
    }
    
    if (location?.settings?.timezone) {
      return location.settings.timezone;
    }
    
    // Fallback
    return 'America/Denver';
  }