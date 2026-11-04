#include "gui.h"
#include "pb_profile.h"

// Language setting: 0 = RU, 1 = EN. -1 = autodetect from locale
int g_lang = -1;

typedef struct {
    const char *en;
    const char *ru;
} LocEntry;

static const LocEntry g_loc_table[] = {
    { "File", "Файл" },
    { "_File", "_Файл" },
    { "Proxy", "Прокси" },
    { "_Proxy", "_Прокси" },
    { "Settings", "Настройки" },
    { "_Settings", "_Настройки" },
    { "Help", "Справка" },
    { "_Help", "_Справка" },
    { "About", "О программе" },
    { "_About", "_О программе" },
    { "Exit", "Выход" },
    { "_Exit", "_Выход" },
    { "Start Engine", "Запустить службу" },
    { "Stop Engine", "Остановить службу" },
    { "Check for Updates", "Проверить обновления" },
    { "Check for Updates...", "Проверить обновления..." },
    { "Proxy Rules...", "Правила маршрутизации..." },
    { "Proxy Settings...", "Настройки прокси..." },
    { "Profiles...", "Профили..." },
    { "Enable Traffic Logging", "Вести журнал сетевого трафика" },
    { "DNS via Proxy", "DNS через прокси" },
    { "Run Engine on Startup", "Запускать перехват при старте" },
    { "Dark Theme", "Темная тема" },
    { "Language", "Язык" },
    { "Russian", "Русский" },
    { "English", "English" },
    { "Connections", "Соединения" },
    { "Activity Logs", "Журнал активности" },
    { "Search connections...", "Поиск соединений..." },
    { "Search logs...", "Поиск по журналу..." },
    { "Clear Connections", "Очистить соединения" },
    { "Clear Logs", "Очистить журнал" },
    { "Pause", "Пауза" },
    { "Resume", "Возобновить" },
    { "Proxy Settings", "Настройки прокси" },
    { "Process Rules", "Правила маршрутизации" },
    { "Profiles", "Профили" },
    { "Add Rule", "Добавить правило" },
    { "Edit Rule", "Редактировать правило" },
    { "+ Add Rule", "+ Добавить правило" },
    { "Select All", "Выбрать все" },
    { "Deselect All", "Снять выбор" },
    { "Delete Selected", "Удалить выбранные" },
    { "Import", "Импорт" },
    { "Export", "Экспорт" },
    { "Save", "Сохранить" },
    { "Cancel", "Отмена" },
    { "Delete", "Удалить" },
    { "Close", "Закрыть" },
    { "Edit", "Изменить" },
    { "Browse...", "Обзор..." },
    { "Switch", "Переключить" },
    { "New", "Создать" },
    { "Duplicate", "Дублировать" },
    { "Rename", "Переименовать" },
    { "Start Test", "Начать проверку" },
    { "Name", "Имя" },
    { "Type", "Тип" },
    { "Host", "Узел" },
    { "Port", "Порт" },
    { "Username", "Пользователь" },
    { "Password", "Пароль" },
    { "Default", "По умолчанию" },
    { "Status", "Статус" },
    { "Action", "Действие" },
    { "Protocol", "Протокол" },
    { "SR", "№" },
    { "Process", "Процесс" },
    { "Target Hosts", "Целевые узлы" },
    { "Target:", "Целевой узел:" },
    { "Port:", "Порт:" },
    { "Name:", "Имя:" },
    { "Type:", "Тип:" },
    { "Host:", "Узел (IP/домен):" },
    { "Username:", "Пользователь:" },
    { "Password:", "Пароль:" },
    { "Profile name:", "Имя профиля:" },
    { "New Profile", "Новый профиль" },
    { "Duplicate Profile", "Дублировать профиль" },
    { "Rename Profile", "Переименовать профиль" },
    { "Import Profile", "Импортировать профиль" },
    { "Export Profile", "Экспортировать профиль" },
    { "Test Selected Proxy", "Проверка выбранного прокси" },
    { "Set Default", "По умолчанию" },
    { "Move up (higher priority)", "Поднять (выше приоритет)" },
    { "Move down (lower priority)", "Опустить (ниже приоритет)" },
    { "Are you sure you want to delete %d selected rules?", "Вы уверены, что хотите удалить %d выбранных правил?" },
    { "Are you sure you want to delete rule '%s'?", "Вы уверены, что хотите удалить правило '%s'?" },
    { "Delete proxy '%s'?\nRules using it will fall back to the default proxy.", "Удалить прокси '%s'?\nПравила, использующие его, переключатся на прокси по умолчанию." },
    { "The proxy engine is currently running. Do you want to stop it and exit?", "Служба перехвата трафика активна. Остановить службу и выйти?" },
    { "Another instance of PEC is already running.", "Другой экземпляр PEC уже запущен." },
    { "Select rule for bulk actions", "Выбрать правило для массовых действий" },
    { "Enable or disable this rule", "Включить или отключить правило" },
    { "Rule priority order (first match wins)", "Порядок приоритета (первое совпадение)" },
    { "No rules configured. Click '+ Add Rule' to create routing rules.", "Нет настроенных правил. Нажмите «+ Добавить правило», чтобы создать правило." },
    { "No active network connections recorded.", "Нет активных сетевых соединений." },
    { "No activity log entries.", "Журнал активности пуст." },
    { "Show/hide password", "Показать/скрыть пароль" },
    { "Error: Target port must be between 1 and 65535.", "Ошибка: порт должен быть от 1 до 65535." },
    { "Error: Target host cannot be empty.", "Ошибка: целевой узел не может быть пустым." },
    { "Error: Select a proxy to test.", "Ошибка: выберите прокси для проверки." },
    { "Testing connection... Please wait...", "Проверка соединения... Пожалуйста, подождите..." },
    { "Failed to save configuration / profile.\nPlease check disk space and permissions.", "Не удалось сохранить конфигурацию / профиль.\nПроверьте права доступа и свободное место на диске." },
    { "Could not read the selected file.", "Не удалось прочитать выбранный файл." },
    { "No rules found in the file.", "В файле не найдено правил." },
    { "Select Application", "Выбрать приложение" },
    { "Select a proxy first.", "Сначала выберите прокси." },
    { "The last profile cannot be deleted.", "Единственный оставшийся профиль нельзя удалить." },
    { "You are using the latest version (%s).", "У вас установлена последняя версия (%s)." },
    { "Update check failed: %s", "Ошибка проверки обновлений: %s" },
    { "Update check failed (curl exit %d).", "Ошибка проверки обновлений (код curl: %d)." },
    { "Checking for updates...", "Проверка обновлений..." },
    { "Open in Browser", "Открыть в браузере" },
    { "Running", "Работает" },
    { "Stopped", "Остановлен" },
    { "Starting...", "Запуск..." },
    { "Stopping...", "Остановка..." },
    { "Running (Relay unreachable)", "Работает (шлюз недоступен)" },
    { "_Engine", "_Служба" },
    { "_View", "_Вид" },
    { "_Proxy Settings...", "_Настройки прокси..." },
    { "Proxy _Rules...", "_Правила маршрутизации..." },
    { "P_rofiles...", "_Профили..." },
    { "_Quit", "_Выход" },
    { "_Start Engine", "_Запустить службу" },
    { "S_top Engine", "_Остановить службу" },
    { "Enable Traffic _Logging", "_Вести журнал сетевого трафика" },
    { "_DNS via Proxy", "_DNS через прокси" },
    { "Run Engine on _Startup", "Запускать перехват при _старте" },
    { "_Dark Theme", "_Темная тема" },
    { "_Language", "_Язык" },
    { "Check for _Updates...", "Проверить _обновления..." },
    { "_About PEC...", "_О программе PEC..." },
    { "About PEC", "О программе PEC" },
    { "Engine", "Служба" },
    { "Profile", "Профиль" },
    { "Proxies", "Прокси" },
    { "Rules", "Правила" },
    { "conn/s", "соед/сек" },
    { "PEC Service Stopped.", "Служба PEC остановлена." },
    { "PEC Service Started (eBPF).", "Служба PEC запущена (eBPF)." },
    { "Failed to start PEC engine. See the Activity Logs tab.", "Не удалось запустить службу PEC. См. вкладку Журнал активности." },
    { "Failed to start the PEC engine.", "Не удалось запустить службу PEC." },
    { "Open the \"Activity Logs\" tab to see the reason.", "Откройте вкладку «Журнал активности», чтобы увидеть причину." },
    { "The eBPF backend needs root, a kernel >= 5.11 with BTF and cgroup v2.", "Бэкенд eBPF требует root, ядро >= 5.11 с поддержкой BTF и cgroup v2." },
    { "PEC engine is currently running.\nAre you sure you want to exit and stop proxying?", "Служба перехвата PEC активна.\nВы уверены, что хотите выйти и отключить проксирование?" },
    { "Update check completed.", "Проверка обновлений завершена." },
    { "Update check failed", "Ошибка проверки обновлений" },
    { "A new version is available. Open download page?", "Доступна новая версия. Открыть страницу загрузки?" },
    { "Could not open browser", "Не удалось открыть браузер" },
    { "No safe https url in update feed.", "В данных обновления отсутствует безопасная ссылка https." },
    { "Error: connection to local daemon / relay lost!", "Ошибка: потеряно соединение с локальной службой / реле!" },
    { "PEC Service Connected (eBPF).", "Служба PEC подключена (eBPF)." },
    { "Universal proxy client for Linux applications", "Универсальный прокси-клиент для приложений Linux" },
    { "eBPF backend (needs root, kernel 5.11+ with BTF and cgroup v2)", "Бэкенд eBPF (требует root, ядро 5.11+ с BTF и cgroup v2)" },
    { "Author", "Автор" },
    { "OK", "OK" },
    { "Language set to English (restart for full effect).", "Язык переключен на English (перезапустите для полного эффекта)." },
    { "Язык переключен на русский (перезапустите для полного эффекта).", "Язык переключен на русский (перезапустите для полного эффекта)." },
    { NULL, NULL }
};

static void init_locale_lang(void) {
    if (g_lang >= 0) return;
    const char *l = getenv("LC_ALL");
    if (!l) l = getenv("LC_MESSAGES");
    if (!l) l = getenv("LANG");
    if (l && (strstr(l, "ru") || strstr(l, "RU") || strstr(l, "be") || strstr(l, "uk"))) {
        g_lang = 0; // Russian
    } else {
        g_lang = 1; // English
    }
}

void set_app_language(int lang) {
    g_lang = lang;
}

int get_app_language(void) {
    if (g_lang < 0) init_locale_lang();
    return g_lang;
}

const char *T(const char *s) {
    if (!s) return "";
    if (get_app_language() != 0) return s; // English by default or when g_lang == 1
    for (int i = 0; g_loc_table[i].en != NULL; i++) {
        if (strcmp(g_loc_table[i].en, s) == 0) {
            return g_loc_table[i].ru;
        }
    }
    return s;
}

void show_message(GtkWindow *parent, GtkMessageType type, const char *format, ...) {
    va_list args;
    va_start(args, format);
    char *msg = g_strdup_vprintf(format, args);
    va_end(args);

    GtkWidget *dialog = gtk_message_dialog_new(parent, GTK_DIALOG_DESTROY_WITH_PARENT | GTK_DIALOG_MODAL,
                                               type, GTK_BUTTONS_OK, "%s", msg);
    gtk_dialog_run(GTK_DIALOG(dialog));
    gtk_widget_destroy(dialog);
    g_free(msg);
}

bool gui_confirm(GtkWindow *parent, const char *format, ...) {
    va_list args;
    va_start(args, format);
    char *msg = g_strdup_vprintf(format, args);
    va_end(args);

    GtkWidget *q = gtk_message_dialog_new(parent, GTK_DIALOG_MODAL | GTK_DIALOG_DESTROY_WITH_PARENT,
                                         GTK_MESSAGE_QUESTION, GTK_BUTTONS_YES_NO, "%s", msg);
    int resp = gtk_dialog_run(GTK_DIALOG(q));
    gtk_widget_destroy(q);
    g_free(msg);
    return resp == GTK_RESPONSE_YES;
}

void statusbar_set_text(const char *text) {
    if (!status_bar) return;
    gtk_statusbar_remove_all(GTK_STATUSBAR(status_bar), status_context_id);
    if (text && *text) {
        gtk_statusbar_push(GTK_STATUSBAR(status_bar), status_context_id, text);
    }
}

void init_theme_css(void) {
    GtkCssProvider *provider = gtk_css_provider_new();
    const char *css = 
        ".success { color: #2ecc71; font-weight: bold; }\n"
        ".info { color: #3498db; font-weight: bold; }\n"
        ".warning { color: #e74c3c; font-weight: bold; }\n"
        ".destructive-action { background: #c0392b; color: #ffffff; font-weight: bold; }\n"
        ".badge-rejected { color: #e67e22; font-weight: bold; }\n"
        ".dim-label { color: #888888; }\n";
    gtk_css_provider_load_from_data(provider, css, -1, NULL);
    gtk_style_context_add_provider_for_screen(
        gdk_screen_get_default(),
        GTK_STYLE_PROVIDER(provider),
        GTK_STYLE_PROVIDER_PRIORITY_APPLICATION
    );
    g_object_unref(provider);
}

bool safe_save_config(GtkWindow *parent) {
    save_config();
    const char *dir = pbp_config_dir();
    if (dir && access(dir, W_OK) != 0 && errno == EACCES) {
        show_message(parent, GTK_MESSAGE_ERROR,
                     T("Failed to save configuration / profile.\nPlease check disk space and permissions."));
        return false;
    }
    return true;
}

GtkWidget *combo_new(const char *first, ...) {
    GtkWidget *combo = gtk_combo_box_text_new();
    va_list args;
    va_start(args, first);
    for (const char *s = first; s; s = va_arg(args, const char *))
        gtk_combo_box_text_append_text(GTK_COMBO_BOX_TEXT(combo), s);
    va_end(args);
    return combo;
}

GtkWidget *hint_label(const char *text) {
    GtkWidget *l = gtk_label_new(text);
    gtk_style_context_add_class(gtk_widget_get_style_context(l), "dim-label");
    gtk_widget_set_halign(l, GTK_ALIGN_START);
    gtk_label_set_xalign(GTK_LABEL(l), 0);
    gtk_label_set_line_wrap(GTK_LABEL(l), TRUE);
    gtk_label_set_max_width_chars(GTK_LABEL(l), 60);
    return l;
}

void set_error_label(GtkWidget *label, const char *msg) {
    char *m = g_markup_printf_escaped("<span foreground='#e5534b'>%s</span>", msg);
    gtk_label_set_markup(GTK_LABEL(label), m);
    g_free(m);
}

void grid_row(GtkWidget *grid, int row, const char *label, GtkWidget *widget) {
    GtkWidget *l = gtk_label_new(label);
    gtk_widget_set_halign(l, GTK_ALIGN_START);
    gtk_grid_attach(GTK_GRID(grid), l, 0, row, 1, 1);
    gtk_widget_set_hexpand(widget, TRUE);
    gtk_grid_attach(GTK_GRID(grid), widget, 1, row, 1, 1);
}
