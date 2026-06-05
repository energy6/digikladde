
import { useState, useCallback, useEffect, useMemo } from 'react';
import { ConfigProvider, theme } from 'antd';

function Theme({ children }: { children: React.ReactNode }) {
    const [darkMode, setDarkMode] = useState(false);
    const windowQuery = window.matchMedia("(prefers-color-scheme:dark)");

    const darkModeChange = useCallback((event: MediaQueryListEvent) => {
        console.log(event.matches ? true : false);
        setDarkMode(event.matches ? true : false);
    }, []);

    useEffect(() => {
        windowQuery.addEventListener("change", darkModeChange);
        return () => {
            windowQuery.removeEventListener("change", darkModeChange);
        };
    }, [windowQuery, darkModeChange]);

    useEffect(() => {
        console.log(windowQuery.matches ? true : false);
        setDarkMode(windowQuery.matches ? true : false);
    }, [windowQuery.matches]);

    const algorithm = useMemo(() => {
        return darkMode ? [theme.darkAlgorithm, theme.compactAlgorithm] : theme.compactAlgorithm;
    }, [darkMode]);

    return (
        <ConfigProvider
          theme={{ algorithm }}
        >
          {children}
        </ConfigProvider>
    )
}

export default Theme;;