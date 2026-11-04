#include "gui.h"
#include <glib-unix.h>
#include <signal.h>
#include <sys/socket.h>
#include <sys/un.h>
#include <netinet/in.h>
#include <arpa/inet.h>
#include <fcntl.h>
#include <errno.h>
#include <poll.h>
#include <sys/file.h>
#include <gdk/gdkkeysyms.h>

extern const char *T(const char *s);
extern void statusbar_set_text(GtkWidget *sb, guint ctx, const char *text);
extern bool gui_confirm(GtkWindow *parent, const char *message);
extern void init_theme_css(void);
extern int g_lang;

GtkWidget *window;
GtkTextBuffer *conn_buffer;
GtkTextBuffer *log_buffer;
GtkWidget *status_bar;
guint status_context_id;

GList *g_rules_list = NULL;
bool g_chk_logging = true;
bool g_chk_dns = true;
static GtkWidget *log_item, *dns_item;
static GtkWidget *update_menu_item = NULL;
static GtkWidget *autostart_item = NULL;
static bool g_autostart_engine = false;

static int g_instance_lock_fd = -1;

static bool acquire_instance_lock(void) {
    const char *path = "/var/run/pec-client.lock";
    g_instance_lock_fd = open(path, O_CREAT | O_RDWR, 0644);
    if (g_instance_lock_fd < 0) {
        path = "/tmp/pec-client.lock";
        g_instance_lock_fd = open(path, O_CREAT | O_RDWR, 0644);
    }
    if (g_instance_lock_fd < 0) {
        return true; // proceed if unable to create lock file
    }
    if (flock(g_instance_lock_fd, LOCK_EX | LOCK_NB) < 0) {
        if (errno == EWOULDBLOCK || errno == EAGAIN) {
            close(g_instance_lock_fd);
            g_instance_lock_fd = -1;
            return false;
        }
    }
    return true;
}

static void release_instance_lock(void) {
    if (g_instance_lock_fd >= 0) {
        flock(g_instance_lock_fd, LOCK_UN);
        close(g_instance_lock_fd);
        g_instance_lock_fd = -1;
    }
}

static void load_autostart_pref(void) {
    const char *cfg = "/etc/proxybridge/autostart";
    if (access(cfg, F_OK) == 0) {
        g_autostart_engine = true;
        return;
    }
    const char *home = g_get_home_dir();
    if (home) {
        char *path = g_strdup_printf("%s/.config/proxybridge/autostart", home);
        if (access(path, F_OK) == 0) {
            g_autostart_engine = true;
        }
        g_free(path);
    }
}

static void save_autostart_pref(bool enabled) {
    g_autostart_engine = enabled;
    const char *home = g_get_home_dir();
    char *dir = home ? g_strdup_printf("%s/.config/proxybridge", home) : NULL;
    if (dir) {
        g_mkdir_with_parents(dir, 0755);
        char *path = g_strdup_printf("%s/autostart", dir);
        if (enabled) {
            FILE *f = fopen(path, "w");
            if (f) { fputs("1\n", f); fclose(f); }
        } else {
            unlink(path);
        }
        g_free(path);
        g_free(dir);
    }
}

static void on_autostart_toggled(GtkCheckMenuItem *item, gpointer data) {
    bool active = gtk_check_menu_item_get_active(item);
    save_autostart_pref(active);
}

static void on_log_traffic_toggled(GtkCheckMenuItem *item, gpointer data) {
    bool active = gtk_check_menu_item_get_active(item);
    ProxyBridge_SetTrafficLoggingEnabled(active);
    g_chk_logging = active;
    save_config();
}

static void on_dns_proxy_toggled(GtkCheckMenuItem *item, gpointer data) {
    bool active = gtk_check_menu_item_get_active(item);
    ProxyBridge_SetDnsViaProxy(active);
    g_chk_dns = active;
    save_config();
}

// the switches belong to the profile: after a profile change, show and apply the new profile's values
void gui_sync_switches() {
    ProxyBridge_SetTrafficLoggingEnabled(g_chk_logging);
    ProxyBridge_SetDnsViaProxy(g_chk_dns);
    if (log_item) gtk_check_menu_item_set_active(GTK_CHECK_MENU_ITEM(log_item), g_chk_logging);
    if (dns_item) gtk_check_menu_item_set_active(GTK_CHECK_MENU_ITEM(dns_item), g_chk_dns);
}

// same feed as windows/mac: https://download.interceptsuite.com/proxybridge.json
#define UPD_FEED_URL "https://download.interceptsuite.com/proxybridge.json"

// match "linux": { ... } as a key, not a random "linux" string value
static char *extract_platform_block(const char *json, const char *platform) {
    char needle[64];
    snprintf(needle, sizeof(needle), "\"%s\"", platform);
    size_t nlen = strlen(needle);
    const char *p = json;
    const char *key = NULL;
    while ((p = strstr(p, needle)) != NULL) {
        const char *after = p + nlen;
        while (*after == ' ' || *after == '\t' || *after == '\n' || *after == '\r') after++;
        if (*after == ':') {
            key = p;
            break;
        }
        p += nlen;
    }
    if (!key) return NULL;
    const char *brace = strchr(key, '{');
    if (!brace) return NULL;
    int depth = 0;
    for (const char *q = brace; *q; q++) {
        if (*q == '{') depth++;
        else if (*q == '}') {
            depth--;
            if (depth == 0)
                return g_strndup(brace, (gsize)(q - brace + 1));
        }
    }
    return NULL;
}

static void parse_ver(const char *s, int out[3]) {
    out[0] = out[1] = out[2] = 0;
    if (!s) return;
    while (*s && (*s < '0' || *s > '9')) s++;
    int i = 0;
    while (*s && i < 3) {
        if (*s >= '0' && *s <= '9') {
            int n = 0;
            while (*s >= '0' && *s <= '9') {
                n = n * 10 + (*s - '0');
                s++;
            }
            out[i++] = n;
        } else if (*s == '.') {
            s++;
        } else {
            break;
        }
    }
}

static int ver_cmp(const int a[3], const int b[3]) {
    for (int i = 0; i < 3; i++) {
        if (a[i] != b[i]) return a[i] < b[i] ? -1 : 1;
    }
    return 0;
}

static int https_url_ok(const char *url) {
    if (!url || strncmp(url, "https://", 8) != 0) return 0;
    for (const char *p = url; *p; p++) {
        unsigned char c = (unsigned char)*p;
        if (c < 32 || c > 126) return 0;
        if (c == ' ' || c == '"' || c == '\'' || c == '`' || c == '\\') return 0;
    }
    return 1;
}

typedef struct {
    char *version;
    char *download;
    char *notes;
    char *error_msg;
    int status; // 0 = update available, 1 = up to date, -1 = error
} UpdateCheckResult;

static gboolean update_check_finished(gpointer data) {
    UpdateCheckResult *res = (UpdateCheckResult *)data;
    if (update_menu_item) {
        gtk_widget_set_sensitive(update_menu_item, TRUE);
    }
    statusbar_set_text(status_bar, status_context_id, T("Update check completed."));

    if (res->status == -1) {
        show_message(GTK_WINDOW(window), GTK_MESSAGE_ERROR, "%s: %s",
                     T("Update check failed"), res->error_msg ? res->error_msg : "unknown");
    } else if (res->status == 1) {
        show_message(GTK_WINDOW(window), GTK_MESSAGE_INFO,
                     T("You are using the latest version (%s)."), PROXYBRIDGE_VERSION);
    } else if (res->status == 0) {
        GtkWidget *dialog = gtk_message_dialog_new(GTK_WINDOW(window), GTK_DIALOG_DESTROY_WITH_PARENT,
            GTK_MESSAGE_QUESTION, GTK_BUTTONS_NONE,
            "%s", T("A new version is available. Open download page?"));
        gtk_message_dialog_format_secondary_text(GTK_MESSAGE_DIALOG(dialog),
            "Version %s is available (current: %s).\nOpen the download page in your browser?",
            res->version, PROXYBRIDGE_VERSION);
        gtk_dialog_add_button(GTK_DIALOG(dialog), T("Open in Browser"), GTK_RESPONSE_ACCEPT);
        gtk_dialog_add_button(GTK_DIALOG(dialog), T("Close"), GTK_RESPONSE_CANCEL);
        int resp = gtk_dialog_run(GTK_DIALOG(dialog));
        gtk_widget_destroy(dialog);
        if (resp == GTK_RESPONSE_ACCEPT) {
            const char *url = NULL;
            if (https_url_ok(res->notes)) url = res->notes;
            else if (https_url_ok(res->download)) url = res->download;
            if (!url) {
                show_message(GTK_WINDOW(window), GTK_MESSAGE_ERROR, T("No safe https url in update feed."));
            } else {
                GError *uri_err = NULL;
                if (!gtk_show_uri_on_window(GTK_WINDOW(window), url, GDK_CURRENT_TIME, &uri_err)) {
                    show_message(GTK_WINDOW(window), GTK_MESSAGE_ERROR, "%s: %s",
                                 T("Could not open browser"), uri_err ? uri_err->message : "unknown");
                    if (uri_err) g_error_free(uri_err);
                }
            }
        }
    }

    g_free(res->version);
    g_free(res->download);
    g_free(res->notes);
    g_free(res->error_msg);
    g_free(res);
    return G_SOURCE_REMOVE;
}

static gpointer update_check_worker(gpointer data) {
    UpdateCheckResult *res = g_new0(UpdateCheckResult, 1);
    const char *curl_path = "/usr/bin/curl";
    if (access("/usr/bin/curl", X_OK) != 0 && access("/bin/curl", X_OK) == 0) {
        curl_path = "/bin/curl";
    }
    char *argv[] = {
        (char *)curl_path, (char *)"-sS",
        (char *)"--max-time", (char *)"15",
        (char *)"-H", (char *)"User-Agent: PEC-UpdateChecker",
        (char *)UPD_FEED_URL,
        NULL
    };
    char *json = NULL;
    char *curl_err = NULL;
    GError *spawn_err = NULL;
    int exit_code = 0;

    if (!g_spawn_sync(NULL, argv, NULL, 0, NULL, NULL,
                      &json, &curl_err, &exit_code, &spawn_err)) {
        res->status = -1;
        res->error_msg = g_strdup(spawn_err ? spawn_err->message : "spawn failed");
        if (spawn_err) g_error_free(spawn_err);
        g_free(curl_err);
        g_idle_add(update_check_finished, res);
        return NULL;
    }
    if (exit_code != 0 || !json || json[0] == '\0') {
        res->status = -1;
        res->error_msg = g_strdup_printf("curl exit %d", exit_code);
        g_free(json);
        g_free(curl_err);
        g_idle_add(update_check_finished, res);
        return NULL;
    }

    char *linux_obj = extract_platform_block(json, "linux");
    g_free(json);
    g_free(curl_err);
    if (!linux_obj) {
        res->status = -1;
        res->error_msg = g_strdup("Could not parse linux update info.");
        g_idle_add(update_check_finished, res);
        return NULL;
    }

    res->version = extract_sub_json_str(linux_obj, "version");
    res->download = extract_sub_json_str(linux_obj, "download");
    res->notes = extract_sub_json_str(linux_obj, "release_notes");
    g_free(linux_obj);

    if (!res->version || !res->version[0]) {
        res->status = -1;
        res->error_msg = g_strdup("Could not parse version info.");
        g_idle_add(update_check_finished, res);
        return NULL;
    }

    int cur[3], lat[3];
    parse_ver(PROXYBRIDGE_VERSION, cur);
    parse_ver(res->version, lat);
    if (ver_cmp(lat, cur) <= 0) {
        res->status = 1;
    } else {
        res->status = 0;
    }

    g_idle_add(update_check_finished, res);
    return NULL;
}

static void on_check_update(GtkWidget *widget, gpointer data) {
    if (update_menu_item) {
        gtk_widget_set_sensitive(update_menu_item, FALSE);
    }
    statusbar_set_text(status_bar, status_context_id, T("Checking for updates..."));
    g_thread_new("update_checker", update_check_worker, NULL);
}

static void on_about(GtkWidget *widget, gpointer data) {
    GtkWidget *dialog = gtk_dialog_new_with_buttons(T("About PEC"), GTK_WINDOW(window), GTK_DIALOG_DESTROY_WITH_PARENT | GTK_DIALOG_MODAL, T("OK"), GTK_RESPONSE_OK, NULL);
    gtk_window_set_default_size(GTK_WINDOW(dialog), 420, 320);
    GtkWidget *content_area = gtk_dialog_get_content_area(GTK_DIALOG(dialog));
    gtk_container_set_border_width(GTK_CONTAINER(content_area), 20);
    char *markup = g_strdup_printf(
        "<span size='xx-large' weight='bold'>PEC</span>\n"
        "<span color='#9ca3af'>Version %s</span>\n\n"
        "%s\n"
        "%s\n\n"
        "%s: PEC Team / InterceptSuite\n\n"
        "Website: <a href=\"https://interceptsuite.com\">interceptsuite.com</a>\n"
        "GitHub: <a href=\"https://github.com/InterceptSuite/ProxyBridge\">InterceptSuite/ProxyBridge</a>\n\n"
        "License: AGPL-3.0",
        PROXYBRIDGE_VERSION,
        T("Universal proxy client for Linux applications"),
        T("eBPF backend (needs root, kernel 5.11+ with BTF and cgroup v2)"),
        T("Author"));
    GtkWidget *label = gtk_label_new(NULL);
    gtk_label_set_markup(GTK_LABEL(label), markup);
    gtk_label_set_justify(GTK_LABEL(label), GTK_JUSTIFY_CENTER);
    g_free(markup);
    gtk_box_pack_start(GTK_BOX(content_area), label, TRUE, TRUE, 0);
    gtk_widget_show_all(dialog);
    gtk_dialog_run(GTK_DIALOG(dialog));
    gtk_widget_destroy(dialog);
}

typedef enum { ENGINE_STOPPED, ENGINE_STARTING, ENGINE_RUNNING, ENGINE_STOPPING } EngineState;

static EngineState engine_state = ENGINE_STOPPED;
static GThread *engine_thread = NULL;
static struct { bool start, ok; } engine_job;
static GtkWidget *status_info;
static GtkWidget *start_item, *stop_item;
static guint status_source = 0;
static uint64_t last_conn_count = 0;
static unsigned conn_rate = 0;

static const char *const daemon_socket_paths[] = {
    "/var/run/proxybridge.sock",
    "/run/proxybridge.sock",
    "/tmp/proxybridge.sock"
};

static bool check_tcp_port_connect(uint16_t port) {
    int s = socket(AF_INET, SOCK_STREAM, 0);
    if (s < 0) return false;
    int flags = fcntl(s, F_GETFL, 0);
    fcntl(s, F_SETFL, flags | O_NONBLOCK);
    struct sockaddr_in sin;
    memset(&sin, 0, sizeof(sin));
    sin.sin_family = AF_INET;
    sin.sin_port = htons(port);
    sin.sin_addr.s_addr = htonl(INADDR_LOOPBACK);
    int res = connect(s, (struct sockaddr *)&sin, sizeof(sin));
    bool alive = false;
    if (res == 0) {
        alive = true;
    } else if (errno == EINPROGRESS) {
        struct pollfd pfd = { .fd = s, .events = POLLOUT };
        if (poll(&pfd, 1, 50) > 0) {
            int err = 0;
            socklen_t len = sizeof(err);
            if (getsockopt(s, SOL_SOCKET, SO_ERROR, &err, &len) == 0 && err == 0) {
                alive = true;
            }
        }
    }
    close(s);
    return alive;
}

static bool check_local_daemon_alive(void) {
    // 1. Check known UNIX domain socket paths
    for (size_t i = 0; i < sizeof(daemon_socket_paths) / sizeof(daemon_socket_paths[0]); i++) {
        struct stat st;
        if (stat(daemon_socket_paths[i], &st) == 0 && S_ISSOCK(st.st_mode)) {
            int fd = socket(AF_UNIX, SOCK_STREAM, 0);
            if (fd >= 0) {
                int flags = fcntl(fd, F_GETFL, 0);
                fcntl(fd, F_SETFL, flags | O_NONBLOCK);
                struct sockaddr_un sun;
                memset(&sun, 0, sizeof(sun));
                sun.sun_family = AF_UNIX;
                strncpy(sun.sun_path, daemon_socket_paths[i], sizeof(sun.sun_path) - 1);
                int res = connect(fd, (struct sockaddr *)&sun, sizeof(sun));
                if (res == 0 || errno == EISCONN || errno == EAGAIN || errno == EINPROGRESS) {
                    close(fd);
                    return true;
                }
                close(fd);
            }
        }
    }

    // 2. Check /proc/net/tcp for local relay listening port (24010..24030)
    FILE *f = fopen("/proc/net/tcp", "r");
    if (f) {
        char line[256];
        if (fgets(line, sizeof(line), f)) {
            while (fgets(line, sizeof(line), f)) {
                unsigned int sl, lport, st;
                unsigned int lip;
                if (sscanf(line, "%u: %X:%X %*X:%*X %X", &sl, &lip, &lport, &st) == 4) {
                    if (st == 0x0A && lport >= 24010 && lport <= 24030) {
                        fclose(f);
                        return true;
                    }
                }
            }
        }
        fclose(f);
    }

    // 3. Fallback: probe loopback TCP relay port
    return check_tcp_port_connect(24010);
}

static int daemon_fail_count = 0;
static bool daemon_lost_reported = false;

static void update_status_info() {
    static const char *names[] = {"Stopped", "Starting...", "Running", "Stopping..."};
    const char *state_str = T(names[engine_state]);
    if (engine_state == ENGINE_RUNNING && daemon_lost_reported) {
        state_str = T("Running (Relay unreachable)");
    }
    char *text = g_strdup_printf("%s: %s  |  %s: %s  |  %s: %u  |  %s: %u  |  %u %s",
                                 T("Engine"), state_str,
                                 T("Profile"), g_active_profile ? g_active_profile : "",
                                 T("Proxies"), g_list_length(g_proxies_list),
                                 T("Rules"), g_list_length(g_rules_list),
                                 conn_rate, T("conn/s"));
    gtk_label_set_text(GTK_LABEL(status_info), text);
    g_free(text);
    if (start_item) gtk_widget_set_sensitive(start_item, engine_state == ENGINE_STOPPED);
    if (stop_item) gtk_widget_set_sensitive(stop_item, engine_state == ENGINE_RUNNING);
}

static void check_daemon_health(void) {
    if (engine_state != ENGINE_RUNNING) {
        daemon_fail_count = 0;
        daemon_lost_reported = false;
        return;
    }

    bool alive = check_local_daemon_alive();
    if (!alive) {
        daemon_fail_count++;
        if (daemon_fail_count >= 2 && !daemon_lost_reported) {
            daemon_lost_reported = true;
            statusbar_set_text(status_bar, status_context_id,
                               T("Error: connection to local daemon / relay lost!"));
            gui_log("Health check: connection to local daemon / relay lost\n");
            update_status_info();
        }
    } else {
        if (daemon_lost_reported) {
            daemon_lost_reported = false;
            statusbar_set_text(status_bar, status_context_id,
                               T("PEC Service Connected (eBPF)."));
            gui_log("Health check: connection to local daemon / relay restored\n");
            update_status_info();
        }
        daemon_fail_count = 0;
    }
}

static void set_engine_state(EngineState state) {
    engine_state = state;
    if (state != ENGINE_RUNNING) {
        daemon_fail_count = 0;
        daemon_lost_reported = false;
    }
    update_status_info();
}

static gboolean status_tick(gpointer data) {
    uint64_t now = gui_conn_event_count();
    conn_rate = (unsigned)(now - last_conn_count);
    last_conn_count = now;
    check_daemon_health();
    update_status_info();
    return G_SOURCE_CONTINUE;
}

// runs in the main loop (g_unix_signal_add), so no library calls from a real signal context
static gboolean on_unix_signal(gpointer data) {
    fprintf(stderr, "\nSignal received. Stopping PEC...\n");
    gtk_main_quit();
    return G_SOURCE_REMOVE;
}

static void on_window_destroy(GtkWidget *widget, gpointer data) {
    if (status_source) g_source_remove(status_source);
    status_source = 0;
    gui_logs_stop_timers();
    release_instance_lock();
    gtk_main_quit();
}

static gboolean on_window_delete(GtkWidget *widget, GdkEvent *event, gpointer data) {
    if (engine_state == ENGINE_RUNNING) {
        if (!gui_confirm(GTK_WINDOW(window),
            T("PEC engine is currently running.\nAre you sure you want to exit and stop proxying?"))) {
            return TRUE; // Cancel close
        }
    }
    return FALSE; // Proceed with close
}

static void on_menu_quit(GtkWidget *widget, gpointer data) {
    if (window) {
        gtk_window_close(GTK_WINDOW(window));
    }
}

static gboolean engine_job_done(gpointer data) {
    g_thread_join(engine_thread);
    engine_thread = NULL;
    if (!engine_job.start) {
        set_engine_state(ENGINE_STOPPED);
        statusbar_set_text(status_bar, status_context_id, T("PEC Service Stopped."));
    } else if (engine_job.ok) {
        set_engine_state(ENGINE_RUNNING);
        statusbar_set_text(status_bar, status_context_id, T("PEC Service Started (eBPF)."));
    } else {
        set_engine_state(ENGINE_STOPPED);
        statusbar_set_text(status_bar, status_context_id, T("Failed to start PEC engine. See the Activity Logs tab."));
        show_message(GTK_WINDOW(window), GTK_MESSAGE_ERROR,
            "%s\n\n%s\n%s",
            T("Failed to start the PEC engine."),
            T("Open the \"Activity Logs\" tab to see the reason."),
            T("The eBPF backend needs root, a kernel >= 5.11 with BTF and cgroup v2."));
    }
    return G_SOURCE_REMOVE;
}

static gpointer engine_job_thread(gpointer data) {
    engine_job.ok = engine_job.start ? ProxyBridge_Start() : ProxyBridge_Stop();
    g_idle_add(engine_job_done, NULL);
    return NULL;
}

// Start/Stop can take a second (BPF load, /proc scan), keep them off the UI thread
static void engine_request(bool start) {
    if (engine_thread || engine_state != (start ? ENGINE_STOPPED : ENGINE_RUNNING)) return;
    engine_job.start = start;
    set_engine_state(start ? ENGINE_STARTING : ENGINE_STOPPING);
    engine_thread = g_thread_new("engine", engine_job_thread, NULL);
}

static void on_start_engine(GtkWidget *widget, gpointer data) {
    engine_request(true);
}

static void on_stop_engine(GtkWidget *widget, gpointer data) {
    engine_request(false);
}

// exit path: wait for a pending job, then stop synchronously
static void shutdown_engine() {
    if (engine_thread) {
        g_thread_join(engine_thread);
        engine_thread = NULL;
        engine_state = engine_job.start && engine_job.ok ? ENGINE_RUNNING : ENGINE_STOPPED;
    }
    if (engine_state == ENGINE_RUNNING) ProxyBridge_Stop();
    engine_state = ENGINE_STOPPED;
}

static GtkWidget *add_menu_item_accel(GtkWidget *menu, const char *label, GCallback cb, GtkAccelGroup *accel_group, guint key, GdkModifierType mods) {
    GtkWidget *item = gtk_menu_item_new_with_mnemonic(label);
    if (cb) g_signal_connect(item, "activate", cb, NULL);
    if (accel_group && key) {
        gtk_widget_add_accelerator(item, "activate", accel_group, key, mods, GTK_ACCEL_VISIBLE);
    }
    gtk_menu_shell_append(GTK_MENU_SHELL(menu), item);
    return item;
}

static GtkWidget *add_check_item_mnemonic(GtkWidget *menu, const char *label, bool active, GCallback cb) {
    GtkWidget *item = gtk_check_menu_item_new_with_mnemonic(label);
    gtk_check_menu_item_set_active(GTK_CHECK_MENU_ITEM(item), active);
    if (cb) g_signal_connect(item, "toggled", cb, NULL);
    gtk_menu_shell_append(GTK_MENU_SHELL(menu), item);
    return item;
}

static void add_separator(GtkWidget *menu) {
    gtk_menu_shell_append(GTK_MENU_SHELL(menu), gtk_separator_menu_item_new());
}

static GtkWidget *add_submenu_mnemonic(GtkWidget *menubar, const char *label) {
    GtkWidget *item = gtk_menu_item_new_with_mnemonic(label);
    GtkWidget *menu = gtk_menu_new();
    gtk_menu_item_set_submenu(GTK_MENU_ITEM(item), menu);
    gtk_menu_shell_append(GTK_MENU_SHELL(menubar), item);
    return menu;
}

static void on_dark_theme_toggled(GtkCheckMenuItem *item, gpointer data) {
    gboolean prefer_dark = gtk_check_menu_item_get_active(item);
    GtkSettings *settings = gtk_settings_get_default();
    if (settings) {
        g_object_set(settings, "gtk-application-prefer-dark-theme", prefer_dark, NULL);
    }
}

static void on_lang_en_activated(GtkMenuItem *item, gpointer data) {
    g_lang = 0;
    statusbar_set_text(status_bar, status_context_id, T("Language set to English (restart for full effect)."));
}

static void on_lang_ru_activated(GtkMenuItem *item, gpointer data) {
    g_lang = 1;
    statusbar_set_text(status_bar, status_context_id, T("Язык переключен на русский (перезапустите для полного эффекта)."));
}

static GtkTextBuffer *add_text_tab(GtkWidget *notebook, const char *title, const char *placeholder, const char *clear_btn_label, GCallback on_search, GCallback on_clear, GCallback on_pause) {
    GtkWidget *tab = gtk_box_new(GTK_ORIENTATION_VERTICAL, 5);
    gtk_container_set_border_width(GTK_CONTAINER(tab), 5);
    GtkWidget *toolbar = gtk_box_new(GTK_ORIENTATION_HORIZONTAL, 5);
    GtkWidget *search = gtk_search_entry_new();
    gtk_entry_set_placeholder_text(GTK_ENTRY(search), placeholder);
    g_signal_connect(search, "search-changed", on_search, NULL);
    GtkWidget *clear_btn = gtk_button_new_with_label(clear_btn_label);
    g_signal_connect(clear_btn, "clicked", on_clear, NULL);
    gtk_box_pack_start(GTK_BOX(toolbar), search, TRUE, TRUE, 0);
    gtk_box_pack_start(GTK_BOX(toolbar), clear_btn, FALSE, FALSE, 0);
    if (on_pause) {
        GtkWidget *pause_btn = gtk_toggle_button_new_with_label(T("Pause"));
        g_signal_connect(pause_btn, "toggled", on_pause, NULL);
        gtk_box_pack_start(GTK_BOX(toolbar), pause_btn, FALSE, FALSE, 0);
    }
    gtk_box_pack_start(GTK_BOX(tab), toolbar, FALSE, FALSE, 0);

    GtkWidget *view = gtk_text_view_new();
    gtk_text_view_set_editable(GTK_TEXT_VIEW(view), FALSE);
    gtk_text_view_set_cursor_visible(GTK_TEXT_VIEW(view), FALSE);
    GtkTextBuffer *buffer = gtk_text_view_get_buffer(GTK_TEXT_VIEW(view));
    gtk_text_buffer_create_tag(buffer, "hidden", "invisible", TRUE, NULL);
    GtkWidget *scrolled = gtk_scrolled_window_new(NULL, NULL);
    gtk_container_add(GTK_CONTAINER(scrolled), view);
    gtk_box_pack_start(GTK_BOX(tab), scrolled, TRUE, TRUE, 0);
    gtk_notebook_append_page(GTK_NOTEBOOK(notebook), tab, gtk_label_new(title));
    return buffer;
}

int main(int argc, char *argv[]) {
    if (getuid() != 0) {
        gtk_init(&argc, &argv);
        const char *wayland = g_getenv("WAYLAND_DISPLAY");
        const char *session_type = g_getenv("XDG_SESSION_TYPE");
        bool is_wayland = (wayland != NULL && wayland[0] != '\0') ||
                          (session_type != NULL && g_strcmp0(session_type, "wayland") == 0);
        if (is_wayland) {
            show_message(NULL, GTK_MESSAGE_ERROR,
                "PEC requires root privileges (eBPF).\n\n"
                "Under Wayland, running sudo directly may fail to open the display.\n"
                "Please run with pkexec:\n"
                "  pkexec /usr/local/bin/ProxyBridgeGUI\n\n"
                "Or authorize root on Xwayland:\n"
                "  xhost +SI:localuser:root && sudo /usr/local/bin/ProxyBridgeGUI");
        } else {
            show_message(NULL, GTK_MESSAGE_ERROR,
                "PEC requires root privileges (eBPF).\n\n"
                "Please run with sudo or pkexec:\n"
                "  pkexec /usr/local/bin/ProxyBridgeGUI\n"
                "or\n"
                "  sudo /usr/local/bin/ProxyBridgeGUI");
        }
        return 1;
    }

    if (!acquire_instance_lock()) {
        gtk_init(&argc, &argv);
        show_message(NULL, GTK_MESSAGE_WARNING, "Another instance of PEC is already running.");
        return 1;
    }

    setenv("GSETTINGS_BACKEND", "memory", 1);
    load_config();
    load_autostart_pref();
    gtk_init(&argc, &argv);
    init_theme_css();

    GtkSettings *settings = gtk_settings_get_default();
    gboolean prefer_dark = FALSE;
    if (settings) {
        g_object_get(settings, "gtk-application-prefer-dark-theme", &prefer_dark, NULL);
    }

    window = gtk_window_new(GTK_WINDOW_TOPLEVEL);
    char *win_title = g_strdup_printf("PEC - %s", g_active_profile ? g_active_profile : "");
    gtk_window_set_title(GTK_WINDOW(window), win_title);
    g_free(win_title);
    gtk_window_set_default_size(GTK_WINDOW(window), 900, 600);
    gtk_window_set_icon_name(GTK_WINDOW(window), "network-vpn");
    g_signal_connect(window, "delete-event", G_CALLBACK(on_window_delete), NULL);
    g_signal_connect(window, "destroy", G_CALLBACK(on_window_destroy), NULL);

    GtkAccelGroup *accel_group = gtk_accel_group_new();
    gtk_window_add_accel_group(GTK_WINDOW(window), accel_group);

    GtkWidget *vbox = gtk_box_new(GTK_ORIENTATION_VERTICAL, 0);
    gtk_container_add(GTK_CONTAINER(window), vbox);

    GtkWidget *menubar = gtk_menu_bar_new();

    // 1. _File menu
    GtkWidget *file_menu = add_submenu_mnemonic(menubar, T("_File"));
    add_menu_item_accel(file_menu, T("_Proxy Settings..."), G_CALLBACK(on_proxy_configure), accel_group, GDK_KEY_p, GDK_CONTROL_MASK);
    add_menu_item_accel(file_menu, T("Proxy _Rules..."), G_CALLBACK(on_proxy_rules_clicked), accel_group, GDK_KEY_r, GDK_CONTROL_MASK);
    add_menu_item_accel(file_menu, T("P_rofiles..."), G_CALLBACK(on_profiles_clicked), NULL, 0, 0);
    add_separator(file_menu);
    add_menu_item_accel(file_menu, T("_Quit"), G_CALLBACK(on_menu_quit), accel_group, GDK_KEY_q, GDK_CONTROL_MASK);

    // 2. _Engine menu
    GtkWidget *engine_menu = add_submenu_mnemonic(menubar, T("_Engine"));
    start_item = add_menu_item_accel(engine_menu, T("_Start Engine"), G_CALLBACK(on_start_engine), NULL, 0, 0);
    stop_item = add_menu_item_accel(engine_menu, T("S_top Engine"), G_CALLBACK(on_stop_engine), NULL, 0, 0);
    add_separator(engine_menu);
    log_item = add_check_item_mnemonic(engine_menu, T("Enable Traffic _Logging"), g_chk_logging, G_CALLBACK(on_log_traffic_toggled));
    dns_item = add_check_item_mnemonic(engine_menu, T("_DNS via Proxy"), g_chk_dns, G_CALLBACK(on_dns_proxy_toggled));
    autostart_item = add_check_item_mnemonic(engine_menu, T("Run Engine on _Startup"), g_autostart_engine, G_CALLBACK(on_autostart_toggled));

    // 3. _View menu
    GtkWidget *view_menu = add_submenu_mnemonic(menubar, T("_View"));
    add_check_item_mnemonic(view_menu, T("_Dark Theme"), prefer_dark, G_CALLBACK(on_dark_theme_toggled));
    GtkWidget *lang_item = gtk_menu_item_new_with_mnemonic(T("_Language"));
    GtkWidget *lang_menu = gtk_menu_new();
    gtk_menu_item_set_submenu(GTK_MENU_ITEM(lang_item), lang_menu);
    gtk_menu_shell_append(GTK_MENU_SHELL(view_menu), lang_item);
    add_menu_item_accel(lang_menu, "English", G_CALLBACK(on_lang_en_activated), NULL, 0, 0);
    add_menu_item_accel(lang_menu, "Русский", G_CALLBACK(on_lang_ru_activated), NULL, 0, 0);

    // 4. _Help menu
    GtkWidget *help_menu = add_submenu_mnemonic(menubar, T("_Help"));
    update_menu_item = add_menu_item_accel(help_menu, T("Check for _Updates..."), G_CALLBACK(on_check_update), NULL, 0, 0);
    add_separator(help_menu);
    add_menu_item_accel(help_menu, T("_About PEC..."), G_CALLBACK(on_about), NULL, 0, 0);

    gtk_box_pack_start(GTK_BOX(vbox), menubar, FALSE, FALSE, 0);

    GtkWidget *notebook = gtk_notebook_new();
    gtk_box_pack_start(GTK_BOX(vbox), notebook, TRUE, TRUE, 0);
    conn_buffer = add_text_tab(notebook, T("Connections"), T("Search connections..."), T("Clear Connections"), G_CALLBACK(on_search_conn_changed), G_CALLBACK(on_clear_conn_clicked), G_CALLBACK(on_pause_conn_toggled));
    log_buffer = add_text_tab(notebook, T("Activity Logs"), T("Search logs..."), T("Clear Logs"), G_CALLBACK(on_search_log_changed), G_CALLBACK(on_clear_log_clicked), NULL);

    GtkWidget *status_box = gtk_box_new(GTK_ORIENTATION_HORIZONTAL, 10);
    status_bar = gtk_statusbar_new();
    status_context_id = gtk_statusbar_get_context_id(GTK_STATUSBAR(status_bar), "Status");
    status_info = gtk_label_new("");
    gtk_widget_set_margin_end(status_info, 10);
    gtk_box_pack_start(GTK_BOX(status_box), status_bar, TRUE, TRUE, 0);
    gtk_box_pack_end(GTK_BOX(status_box), status_info, FALSE, FALSE, 0);
    gtk_box_pack_start(GTK_BOX(vbox), status_box, FALSE, FALSE, 0);
    gui_logs_init();

    ProxyBridge_SetLogCallback(lib_log_callback);
    ProxyBridge_SetConnectionCallback(lib_connection_callback);
    ProxyBridge_SetTrafficLoggingEnabled(g_chk_logging);
    ProxyBridge_SetDnsViaProxy(g_chk_dns);
    apply_proxies_to_lib();
    apply_rules_to_lib();

    g_unix_signal_add(SIGINT, on_unix_signal, NULL);
    g_unix_signal_add(SIGTERM, on_unix_signal, NULL);

    gtk_widget_show_all(window);
    update_status_info();
    status_source = g_timeout_add_seconds(1, status_tick, NULL);

    if (g_autostart_engine) {
        engine_request(true);
    }

    gtk_main();

    shutdown_engine();
    gui_logs_free();
    config_free_all();
    release_instance_lock();
    return 0;
}
