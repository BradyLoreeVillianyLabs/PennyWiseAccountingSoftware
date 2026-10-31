# ClearLedger WordPress Design Fidelity Ledger

## References

- `design-reference/clearledger-landing-hero.png`: first viewport and migration rail;
- `design-reference/clearledger-landing-sections.png`: feature rows, commerce rail, safety, verification, and footer.

Both concept files were inspected at original detail before implementation. The implemented surface is the shortcode markup in `clearledger-public-beta-site/includes/class-clearledger-beta-page.php` and the scoped design system in `clearledger-public-beta-site/assets/css/public-beta.css`.

## Comparison ledger

| Area                    | Concept evidence                                                           | Implementation evidence                                                                                               | Result                                                    |
| ----------------------- | -------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------- |
| First viewport          | Quiet wordmark/navigation, editorial two-column hero, one product frame    | `.cl-site-header`, `.cl-hero-grid`, and the screenshot-or-illustrative `.cl-hero-product`                             | Matched in structure                                      |
| Typography              | Large ink-coloured editorial serif headings with compact humanist controls | Georgia/Times display stack, Segoe/Aptos/system body stack, explicit control sizes                                    | Matched without remote fonts                              |
| Palette                 | Warm ivory, deep ink navy, evergreen, restrained brass, fine rules         | Scoped tokens `--cl-ivory`, `--cl-ink`, `--cl-evergreen`, `--cl-brass`, and `--cl-line`; validation rejects gradients | Matched                                                   |
| Migration               | Three open steps connected by rules, not cards                             | `.cl-step-rail` with numbered semantic list and responsive stacking                                                   | Matched; copy expanded for reconciliation safety          |
| Feature overview        | Open icon/title/description rows                                           | `.cl-feature-list` with eight semantic feature rows and reusable line icons                                           | Matched                                                   |
| Commerce process        | Dark evergreen horizontal process rail                                     | `.cl-commerce-rail` with four connected stages and a provider-boundary note                                           | Matched visually; accounting claim deliberately tightened |
| Beta safety             | Split editorial disclosure with check list                                 | `.cl-safety-grid`, complete limitations summary, and professional-review warning                                      | Matched and expanded                                      |
| Download integrity      | Bordered version/hash panel and two actions                                | `.cl-download-panel`, fail-closed release gate, checksum copy, PowerShell/macOS verification                          | Matched and made functional                               |
| Footer/support          | Dark footer with limitations, install, bug, privacy                        | Stable `/clearledger-support/` route, separate private-security guidance, footer resource links                       | Expanded for the documented support contract              |
| Responsive continuation | Desktop design should remain readable on mobile                            | 1120 px, 820 px, and 600 px adaptations; horizontal nav remains keyboard-scrollable; rails become semantic stacks     | Implemented in CSS                                        |

## Intentional accuracy deviations

- Fake currency totals, customer names, testimonials, counts, and product statistics from the visual concept were not shipped. The fallback product frame is explicitly labelled illustrative and uses status words rather than financial claims.
- The concept's final commerce stage suggested that approved activity posts automatically. The site instead says that connector evidence stays inside review/reconciliation and only separately released, authorized workflows may affect accounting.
- Decorative uppercase kickers were omitted. They were not needed for hierarchy and would read like marketing claims.
- No external font, analytics, image, script, icon, or paid library is loaded by default.

## Remaining publication check

The scoped assignment prohibited publishing or controlling a browser. Therefore no theme-specific browser screenshot was created, and browser-to-concept agency sign-off is intentionally left to the final WordPress staging preview. Before publishing, preview the actual active WordPress theme at desktop and mobile widths, compare it to both concept images, and verify page-template width, focus visibility, navigation wrapping, screenshot cropping, checksum copy, and `/clearledger-support/`. No current code-level mismatch is known, but theme CSS can affect the surrounding page outside the plugin's scoped selectors.
