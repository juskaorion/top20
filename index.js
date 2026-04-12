<div id="top20-app-container" style="background-color: #09090b; min-height: 500px; width: 100%; color: #e4e4e7; font-family: sans-serif; overflow: hidden; position: relative;">
    <div id="top20-app-render"></div>

    <script src="https://cdn.tailwindcss.com"></script>
    <script src="https://unpkg.com/react@18/umd/react.production.min.js"></script>
    <script src="https://unpkg.com/react-dom@18/umd/react-dom.production.min.js"></script>
    <script src="https://unpkg.com/lucide@latest"></script>

    <style>
        @import url('https://fonts.googleapis.com/css2?family=Inter:wght@400;700;900&display=swap');
        
        #top20-app-container { font-family: 'Inter', sans-serif !important; }
        #top20-app-container button { border: none !important; background: none !important; cursor: pointer !important; padding: 0; outline: none !important; color: inherit; }
        
        /* Kortin kompakti tyyli */
        .top20-card {
            background: linear-gradient(145deg, #131316, #09090b) !important;
            border: 1px solid #1f1f23 !important;
            border-radius: 0.75rem !important;
            transition: all 0.2s ease-out !important;
            position: relative !important;
        }
        .top20-card:hover { border-color: #f97316 !important; background: #18181b !important; }
        .top20-card-active { border-color: #f97316 !important; background: #18181b !important; box-shadow: 0 4px 20px -5px rgba(249, 115, 22, 0.3) !important; }
        
        /* Tuottajakuvan dynaaminen CSS-pakotus mobiiliin ja desktopiin */
        .top20-producer-img {
            width: 32px !important;
            height: 32px !important;
            min-width: 32px !important;
            max-width: 32px !important;
            border-radius: 50% !important;
            object-fit: cover !important;
            margin: 0 !important;
            padding: 0 !important;
            border: 1px solid rgba(255,255,255,0.1) !important;
            box-shadow: 0 4px 10px rgba(0,0,0,0.5) !important;
        }
        @media (min-width: 768px) {
            .top20-producer-img {
                width: 44px !important;
                height: 44px !important;
                min-width: 44px !important;
                max-width: 44px !important;
            }
        }

        /* Emojien PAKOTETTU koko */
        .top20-emoji-img {
            width: 14px !important;
            height: 14px !important;
            min-width: 14px !important;
            max-width: 14px !important;
            display: inline-block !important;
            margin: 0 !important;
            padding: 0 !important;
            border: none !important;
            box-shadow: none !important;
            object-fit: contain !important;
            vertical-align: middle !important;
        }
    </style>

    <script>
        (function() {
            const h = React.createElement;
            const DATA_URL = "https://raw.githubusercontent.com/juskaorion/top20/main/top20_songs.json";

            function App() {
                const [data, setData] = React.useState(null);
                const [loading, setLoading] = React.useState(true);
                const [refreshing, setRefreshing] = React.useState(false);
                const [currentSong, setCurrentSong] = React.useState(null);
                const [isPlaying, setIsPlaying] = React.useState(false);
                const [expandedMsgs, setExpandedMsgs] = React.useState({});
                const [expandedComments, setExpandedComments] = React.useState({});
                const [audioError, setAudioError] = React.useState(null);
                const audioRef = React.useRef(null);

                const fetchData = async (isManual = false) => {
                    try {
                        if (isManual) setRefreshing(true);
                        const res = await fetch(DATA_URL + '?t=' + Date.now());
                        const json = await res.json();
                        setData(json);
                    } catch (e) { console.error("Haku epäonnistui", e); }
                    finally { setLoading(false); setRefreshing(false); }
                };

                React.useEffect(() => { 
                    fetchData();
                    const iconTimer = setInterval(() => { if (window.lucide) window.lucide.createIcons(); }, 1000);
                    return () => clearInterval(iconTimer);
                }, []);

                const selectSong = (song) => {
                    setAudioError(null);
                    if (currentSong?.audio_url === song.audio_url) {
                        if (isPlaying) { audioRef.current.pause(); setIsPlaying(false); }
                        else { audioRef.current.play(); setIsPlaying(true); }
                    } else {
                        setCurrentSong(song);
                        setIsPlaying(true);
                        setTimeout(() => { 
                            if (audioRef.current) {
                                audioRef.current.play().catch(function() {
                                    setAudioError("Tiedostoa ei voida toistaa.");
                                    setIsPlaying(false);
                                });
                            }
                        }, 150);
                    }
                };

                if (loading) return h('div', { className: "py-40 text-center" }, 
                    h('i', { 'data-lucide': 'loader-2', className: "animate-spin text-orange-500", style: {width: 40, height: 40, display: 'inline-block'} })
                );

                return h('div', { className: "max-w-2xl mx-auto px-3 md:px-4 py-6 pb-40" },
                    // Otsikko (div-tagit h1/h2 sijaan ohittamaan teeman pakotukset)
                    h('div', { className: "flex justify-between items-end mb-6 border-b border-zinc-800 pb-3" },
                        h('div', null,
                            h('div', { className: "text-lg md:text-2xl font-black uppercase text-white leading-tight m-0" }, "Uuden Tanssimusiikin Lista"),
                            h('div', { className: "text-[8px] md:text-[9px] font-bold tracking-[0.2em] uppercase text-zinc-500 mt-1 m-0" }, 
                                "Päivitetty: " + new Date(data?.last_updated).toLocaleString('fi-FI')
                            )
                        ),
                        h('button', { onClick: function() { fetchData(true); }, className: "bg-zinc-900 p-2 rounded-full text-zinc-500 hover:text-orange-500" },
                            h('i', { 'data-lucide': 'refresh-ccw', className: refreshing ? "animate-spin text-orange-500" : "", style: {width: 14} })
                        )
                    ),
                    // Lista
                    h('div', { className: "space-y-2" },
                        data?.top_songs.map(function(song, idx) {
                            const isActive = currentSong?.audio_url === song.audio_url;
                            return h('div', { key: idx, className: "top20-card p-2.5 md:p-3 flex flex-row items-center gap-3 md:gap-4 " + (isActive ? "top20-card-active" : "") },
                                
                                // VASEN REUNA: Rank numero ja Play-nappi
                                h('div', { className: "flex items-center justify-between w-12 md:w-14 flex-shrink-0" },
                                    h('div', { className: "text-lg md:text-xl font-black italic text-zinc-600 w-5 text-center" }, song.rank),
                                    h('button', { 
                                        onClick: function() { selectSong(song); }, 
                                        className: "w-7 h-7 md:w-8 md:h-8 rounded-full flex items-center justify-center shadow-lg transition-transform hover:scale-105 " + (isActive && isPlaying ? "bg-white text-black" : "bg-zinc-800 text-white hover:bg-orange-500 hover:text-black")
                                    },
                                        h('i', { 'data-lucide': isActive && isPlaying ? 'pause' : 'play', style: {width: 12}, className: !(isActive && isPlaying) ? "ml-0.5" : "" })
                                    )
                                ),

                                // KESKIOSA: Tekstit
                                h('div', { className: "flex-grow min-w-0" },
                                    h('div', { className: "flex items-center gap-1.5 md:gap-2 mb-0.5 text-[8px] md:text-[9px] font-black uppercase tracking-widest text-orange-500/80 truncate" },
                                        h('span', null, song.author), 
                                        h('span', { className: "text-zinc-800" }, "•"), 
                                        h('span', { className: "text-zinc-600 font-mono flex-shrink-0" }, "Score: " + song.score)
                                    ),
                                    // Biisin nimi divillä h2 sijaan
                                    h('div', { className: "text-xs md:text-sm font-bold text-white mb-1 truncate leading-tight" }, song.song_title),
                                    
                                    song.message_text && h('div', { className: "mb-1.5" },
                                        h('div', { className: "text-[9px] md:text-[10px] text-zinc-400 leading-snug m-0 " + (expandedMsgs[idx] ? "" : "line-clamp-1") }, song.message_text),
                                        song.message_text.length > 50 && h('button', { 
                                            onClick: function() { setExpandedMsgs(function(p) { return {...p, [idx]: !p[idx]}; }); },
                                            className: "mt-1 text-[8px] md:text-[9px] font-black uppercase text-zinc-500 hover:text-orange-500"
                                        }, expandedMsgs[idx] ? "Sulje" : "Lue lisää")
                                    ),
                                    
                                    // EMOJIT JA KOMMENTIT RIVI
                                    h('div', { className: "flex items-center flex-wrap gap-2 md:gap-3 mt-1.5" },
                                        song.reactions && song.reactions.length > 0 ? (
                                            h('div', { className: "flex items-center flex-wrap gap-1 md:gap-1.5" },
                                                song.reactions.map(function(r, rIdx) {
                                                    return h('div', { key: rIdx, className: "flex items-center gap-1 bg-white/5 border border-white/5 px-1 md:px-1.5 py-0.5 rounded-md" },
                                                        r.url ? h('img', { src: r.url, alt: r.name, className: "top20-emoji-img" }) : h('span', { className: "text-[10px] md:text-[11px] leading-none" }, r.name),
                                                        h('span', { className: "text-[8px] md:text-[9px] font-bold text-zinc-400" }, r.count)
                                                    )
                                                })
                                            )
                                        ) : (
                                            h('div', { className: "text-[8px] md:text-[9px] font-black text-zinc-600 uppercase flex items-center gap-1" }, 
                                                h('i', { 'data-lucide': 'flame', className: "text-zinc-600", style: {width: 10} }), 
                                                (song.stats.reactions || 0) + " reaktiota"
                                            )
                                        ),

                                        song.stats.comments > 0 && h('button', { 
                                            onClick: function() { setExpandedComments(function(p) { return {...p, [idx]: !p[idx]}; }); },
                                            className: "text-[8px] md:text-[9px] font-black uppercase text-zinc-500 hover:text-white flex items-center gap-1 bg-zinc-800/50 px-1.5 py-1 rounded-md"
                                        }, 
                                            h('i', { 'data-lucide': 'message-square', style: {width: 10} }), 
                                            song.stats.comments + " kommenttia"
                                        )
                                    ),

                                    expandedComments[idx] && h('div', { className: "mt-2 pt-2 border-t border-white/5 space-y-1" },
                                        song.comments.filter(c => c.text).map(function(c, i) {
                                            return h('div', { key: i, className: "text-[9px] md:text-[10px] bg-white/5 p-2 rounded-md border border-white/5" },
                                                h('span', { className: "text-orange-500/70 font-bold mr-1.5 uppercase text-[7px] md:text-[8px]" }, c.author),
                                                h('span', { className: "text-zinc-400 leading-snug" }, c.text)
                                            );
                                        })
                                    )
                                ),

                                // OIKEA REUNA: Pieni tuottajakuva
                                h('div', { className: "flex-shrink-0 pl-1 md:pl-2" },
                                    h('img', { src: song.author_avatar, className: "top20-producer-img" })
                                )
                            );
                        })
                    ),
                    // Kelluva Soitin alareunassa
                    currentSong && h('div', { className: "fixed bottom-4 md:bottom-6 left-1/2 -translate-x-1/2 w-[95%] md:w-[90%] max-w-md bg-zinc-900/95 border border-orange-500/20 p-3 md:p-4 rounded-2xl shadow-2xl z-[9999] backdrop-blur-xl ring-1 ring-white/10" },
                        h('div', { className: "flex flex-col gap-2" },
                            audioError && h('div', { className: "text-center text-[8px] font-bold text-red-500 uppercase m-0" }, audioError),
                            h('div', { className: "flex items-center gap-3" },
                                h('div', { className: "flex-grow min-w-0" },
                                    h('div', { className: "text-[8px] font-black text-orange-500 uppercase tracking-widest truncate m-0" }, currentSong.author),
                                    // Playerin title divinä h3 sijaan
                                    h('div', { className: "text-[11px] md:text-xs font-bold text-white truncate m-0 leading-tight" }, currentSong.song_title)
                                ),
                                h('button', { 
                                    onClick: function() { selectSong(currentSong); },
                                    className: "w-8 h-8 md:w-10 md:h-10 bg-white text-black rounded-full flex items-center justify-center shadow-xl hover:scale-105 active:scale-95 transition-all flex-shrink-0"
                                }, h('i', { 'data-lucide': isPlaying ? 'pause' : 'play', style: {width: 16}, className: !isPlaying ? "ml-0.5" : "" }))
                            ),
                            h('audio', { 
                                ref: audioRef, 
                                src: currentSong.audio_url, 
                                onPlay: function() { setIsPlaying(true); }, 
                                onPause: function() { setIsPlaying(false); }, 
                                onEnded: function() { setIsPlaying(false); },
                                className: "w-full h-4 opacity-40 hover:opacity-100 transition-opacity",
                                controls: true 
                            })
                        )
                    )
                );
            }

            const root = ReactDOM.createRoot(document.getElementById('top20-app-render'));
            root.render(h(App));
        })();
    </script>
</div>
