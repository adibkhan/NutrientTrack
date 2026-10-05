# Standard Compact – screen set

18 screens: 13 phone (390×844) and 5 desktop (1440×1000).

screens/   Standalone HTML renders. Open screens/index.html for a gallery; every link, tab and back arrow
           moves between screens. No build step, no runtime. Font: IBM Plex Sans via Google Fonts
           (falls back to system sans offline).
source/    The original artboard sources (.dc.html) from the design canvas, including the live logic
           (steppers, toggles, range pickers). These need the canvas runtime and are kept for reference.

Tokens used across all screens
  Background #FFFFFF · card border #E4E7EC · row divider #EEF0F3 · text #101828 · secondary #667085
  Accent #2E6FE8 (soft #EAF1FE) · carbs #7A5AF8 · fat #E08A1E · warning #B54708 on #FFF4E5
  Radius 10 cards / 8 controls · row height 44 · gutter 16 · font IBM Plex Sans 400/500/600/700
