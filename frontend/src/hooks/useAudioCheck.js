import { useEffect, useState } from 'react';

const CHECK_AFTER_MS = 3000;

function buildMessage(video) {
  // Server ne video dekha tha par audio track mila hi nahi
  if (video?.videoCodec && !video?.audioCodec) return 'This movie has no audio track.';
  const codec = video?.audioCodec ? ` (${video.audioCodec})` : '';
  return `Your browser can't play this movie's sound${codec}. Ask the host to upload it as MP4 (H.264 + AAC).`;
}

// Movie chalte hue 3 sec baad browser se poochta hai: "awaaz decode hui?"
// Chrome, Edge aur Safari mein ye number milta hai. 0 ho to awaaz nahi chal rahi.
export function useAudioCheck(videoRef, video) {
  const [warning, setWarning] = useState('');
  const videoId = video ? video.id : null;

  useEffect(() => {
    setWarning('');
    const el = videoRef.current;
    if (!el || videoId === null) return;

    let timer = null;

    function startCheck() {
      clearTimeout(timer);
      timer = setTimeout(() => {
        if (el.paused || el.muted || el.volume === 0 || el.currentTime < 2) return;
        if (typeof el.webkitAudioDecodedByteCount !== 'number') return; // Firefox mein check nahi ho sakta
        if (el.webkitAudioDecodedByteCount === 0) setWarning(buildMessage(video));
      }, CHECK_AFTER_MS);
    }
    function stopCheck() {
      clearTimeout(timer);
    }

    el.addEventListener('playing', startCheck);
    el.addEventListener('pause', stopCheck);
    el.addEventListener('emptied', stopCheck);

    return () => {
      clearTimeout(timer);
      el.removeEventListener('playing', startCheck);
      el.removeEventListener('pause', stopCheck);
      el.removeEventListener('emptied', stopCheck);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [videoRef, videoId]);

  return warning;
}