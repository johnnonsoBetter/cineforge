import iconSrc from '../assets/cineforge-icon.png';
import lockupSrc from '../assets/cineforge-lockup.png';

// The CineForge brand mark, used everywhere the wordmark used to be typed out.
//   `icon`   — the film-strip "C" + play button, for compact spots (nav bars, top bar).
//   `lockup` — the full stacked logo (icon + wordmark + tagline), for hero moments.
// Assets are inlined at build time (viteSingleFile), so this works offline like the rest.
export default function Logo({ variant = 'icon', className = '', alt = 'CineForge', ...rest }) {
  return (
    <img
      src={variant === 'lockup' ? lockupSrc : iconSrc}
      alt={alt}
      draggable={false}
      className={`cf-logo cf-logo--${variant}${className ? ` ${className}` : ''}`}
      {...rest}
    />
  );
}
