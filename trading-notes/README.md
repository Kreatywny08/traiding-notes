# Trading Notes

Prywatna aplikacja do notatek tradingowych: kategorie, tagi, wyszukiwarka, zdjęcia (zrzuty wykresów).
Działa na komputerze i telefonie, dane są wspólne (trzymane w Netlify Blobs), wejście chronione hasłem.

## Wdrożenie na Netlify (ok. 5 minut)

> Uwaga: zwykłe przeciągnięcie folderu do Netlify Drop **nie wystarczy** – aplikacja ma funkcję serwerową
> (zapis notatek i zdjęć), którą Netlify buduje tylko przy wdrożeniu z GitHuba albo przez Netlify CLI.

### Opcja A – GitHub (polecana)
1. Wrzuć cały folder `trading-notes` do nowego (może być prywatnego) repozytorium na GitHubie.
2. Netlify → **Add new site → Import an existing project** → wybierz repo.
   Ustawienia builda wczytają się same z `netlify.toml` (publish: `public`).
3. **Site configuration → Environment variables → Add a variable**:
   `APP_PASSWORD` = Twoje hasło do aplikacji.
4. **Deploys → Trigger deploy** (żeby hasło zaczęło działać).

### Opcja B – Netlify CLI
```bash
npm install
npx netlify-cli login
npx netlify-cli init            # utwórz nową stronę
npx netlify-cli env:set APP_PASSWORD "twoje-haslo"
npx netlify-cli deploy --prod
```

Netlify Blobs nie wymaga żadnej konfiguracji – włącza się automatycznie.

## Na telefonie
Otwórz adres strony → zaloguj się → **Udostępnij → Dodaj do ekranu początkowego** (iPhone)
lub **⋮ → Zainstaluj aplikację** (Android). Będzie działać jak normalna apka, z ikonką.

## Jak używać
- **Kategorie** – w menu bocznym „+”, ołówek przy kategorii = edycja/usunięcie (notatki nie giną, trafiają do „Bez kategorii”).
- **Tagi** – wpisz i Enter/spacja (np. `btc`, `setup`, `błąd`). Kliknięcie tagu filtruje notatki.
- **Zdjęcia** – przycisk, przeciągnięcie albo **Ctrl+V** zrzutu ekranu (np. z TradingView). Są automatycznie zmniejszane.
- **Formatowanie treści**: `# Nagłówek`, `**pogrubienie**`, `*kursywa*`, `- lista`, `1. lista`, `- [ ] / - [x] checklista`, `> wyróżnienie`.
- **Skróty (komputer)**: `N` nowa notatka · `Ctrl+K` szukaj · `Ctrl+S` / `Ctrl+Enter` zapisz · `E` edytuj · `Esc` zamknij.
- Przypięte notatki są zawsze na górze.

## Struktura
```
public/                  frontend (HTML/CSS/JS, PWA)
netlify/functions/api.mjs  API: logowanie, notatki, kategorie, zdjęcia
netlify.toml
```
Hasło zmieniasz w zmiennej `APP_PASSWORD` (po zmianie zrób redeploy – wszystkie urządzenia trzeba będzie zalogować ponownie).
