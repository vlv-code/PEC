# Руководство по участию в разработке (Contributing Guide)

Мы приветствуем предложения по улучшению и доработке проекта! Пожалуйста, ознакомьтесь с основными соглашениями.

---

## Процесс разработки

1. Создайте форк или отдельную ветку для задачи:
   ```bash
   git checkout -b feature/my-improvement
   ```
2. Вносите изменения согласно стандартам кодирования:
   - **Python**: PEP 8, типизация, безопасная работа с файлами и переменными окружения.
   - **JavaScript**: спецификация Manifest V3, строгий синтаксис, асинхронные паттерны (`async/await`), отсутствие утечек памяти в событиях Chrome WebRequest.
3. Обязательно добавьте или обновите тесты при изменении логики компонентов.

---

## Тестирование перед отправкой

Перед созданием Pull Request убедитесь, что все проверки проходят успешно:

```bash
# Проверка синтаксиса расширения
node -c extension/background.js

# Валидация JSON файлов
node -e "JSON.parse(require('fs').readFileSync('extension/manifest.json', 'utf8')); JSON.parse(require('fs').readFileSync('extension/managed_schema.json', 'utf8'));"

# Проверка компиляции Python
python -m py_compile server/app.py server/rotate.py extension/scripts/pack.py

# Запуск юнит-тестов сервера
python server/tests/test_server.py
```

---

## Оформление Pull Request

- Название PR должно отражать суть изменений (например, `fix: prevent race condition on creds rotation`).
- Заполните шаблон Pull Request, описав проблему, внесенные изменения и способ верификации.
