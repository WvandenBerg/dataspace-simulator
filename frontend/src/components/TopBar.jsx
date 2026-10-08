import React, { useState, useEffect } from 'react';
import { Sun, Moon } from 'lucide-react';

import './Components.css';

const TopBar = ({
    onAddParticipant,

    isDemo = false,
    title = 'Data Space Demo',
    showThemeToggle = false,
}) => {
    const [theme, setTheme] = useState(() => {
        return localStorage.getItem('theme') || 'light';
    });

    useEffect(() => {
        document.documentElement.setAttribute('data-theme', theme);
    }, [theme]);

    const toggleTheme = () => {
        const newTheme = theme === 'light' ? 'dark' : 'light';
        setTheme(newTheme);
        localStorage.setItem('theme', newTheme);
        document.documentElement.setAttribute('data-theme', newTheme);
    };

    return (
        <div className="top-bar">
            <div className="top-bar-left" />
            <div className="top-bar-center">
                <div className="top-bar-title">{title}</div>
            </div>
            <div className="top-bar-right">
                {showThemeToggle && (
                    <button onClick={toggleTheme} className="theme-toggle" title="Toggle theme">
                        {theme === 'light' ? <Moon size={18} /> : <Sun size={18} />}
                    </button>
                )}

                {isDemo && (
                    <button onClick={onAddParticipant} className="action-btn participant-btn">
                        + Add Participant
                    </button>
                )}
            </div>
        </div>
    );
};

export default TopBar;
