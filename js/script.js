// Define timezones and cities
const timezones = [
    { city: 'New York', timezone: 'America/New_York' },
    { city: 'Los Angeles', timezone: 'America/Los_Angeles' },
    { city: 'London', timezone: 'Europe/London' },
    { city: 'Berlin', timezone: 'Europe/Berlin' },
    { city: 'Dubai', timezone: 'Asia/Dubai' },
    { city: 'Mumbai', timezone: 'Asia/Kolkata' },
    { city: 'Bangkok', timezone: 'Asia/Bangkok' },
    { city: 'Hong Kong', timezone: 'Asia/Hong_Kong' },
    { city: 'Tokyo', timezone: 'Asia/Tokyo' },
    { city: 'Sydney', timezone: 'Australia/Sydney' },
    { city: 'Singapore', timezone: 'Asia/Singapore' },
    { city: 'São Paulo', timezone: 'America/Sao_Paulo' }
];

// Initialize clocks on page load
document.addEventListener('DOMContentLoaded', () => {
    createClocks();
    updateAllClocks();
    // Update every second
    setInterval(updateAllClocks, 1000);
});

// Create clock cards for each timezone
function createClocks() {
    const clockGrid = document.querySelector('.clock-grid');
    
    timezones.forEach(item => {
        const card = document.createElement('div');
        card.className = 'clock-card';
        card.id = `clock-${item.timezone}`;
        
        card.innerHTML = `
            <div class="city-name">${item.city}</div>
            <div class="time-display">--:--:--</div>
            <div class="am-pm">--</div>
            <div class="date-display">-- -- --</div>
        `;
        
        clockGrid.appendChild(card);
    });
}

// Update all clock displays
function updateAllClocks() {
    timezones.forEach(item => {
        updateClock(item.city, item.timezone);
    });
}

// Update individual clock
function updateClock(city, timezone) {
    const card = document.getElementById(`clock-${timezone}`);
    if (!card) return;
    
    // Get current time in the specified timezone
    const time = new Date();
    const options = {
        timeZone: timezone,
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
        hour12: false
    };
    
    const dateOptions = {
        timeZone: timezone,
        weekday: 'short',
        year: 'numeric',
        month: 'short',
        day: '2-digit'
    };
    
    const formatter = new Intl.DateTimeFormat('en-US', options);
    const dateFormatter = new Intl.DateTimeFormat('en-US', dateOptions);
    
    const timeString = formatter.format(time);
    const dateString = dateFormatter.format(time);
    
    // Extract hours for AM/PM
    const hours = parseInt(timeString.split(':')[0]);
    const ampm = hours >= 12 ? 'PM' : 'AM';
    
    // Update DOM
    const timeDisplay = card.querySelector('.time-display');
    const ampmDisplay = card.querySelector('.am-pm');
    const dateDisplay = card.querySelector('.date-display');
    
    timeDisplay.textContent = timeString;
    ampmDisplay.textContent = ampm;
    dateDisplay.textContent = dateString;
}
