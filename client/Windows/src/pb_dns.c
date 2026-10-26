#include "pb_internal.h"

// DNS snoop cache: maps intercepted A/AAAA answers back to hostnames.

// Pending outgoing DNS queries tracking table (W-1: TXID validation)
#define DNS_PENDING_QUERIES_MAX 512
#define DNS_QUERY_TIMEOUT_MS    5000

typedef struct {
    UINT16    txid;
    char      qname[256];
    ULONGLONG expire_tick;
    BOOL      active;
} DNS_PENDING_QUERY;

static DNS_PENDING_QUERY g_dns_pending[DNS_PENDING_QUERIES_MAX];
static SRWLOCK g_dns_pending_lock;

// dns cache
void dns_cache_init(void)
{
    InitializeSRWLock(&g_dns_cache_lock);
    InitializeSRWLock(&g_dns_pending_lock);
    memset(g_dns_cache,    0, sizeof(g_dns_cache));
    memset(g_dns_cache_v6, 0, sizeof(g_dns_cache_v6));
    memset(g_dns_pending,  0, sizeof(g_dns_pending));
}

UINT32 dns_bucket(UINT32 ip)
{
    return (ip * 2654435761u) >> (32 - 10);  // Knuth multiplicative hash 1024 buckets
}

void dns_cache_store(UINT32 ip, const char *domain)
{
    if (!domain || domain[0] == '\0') return;
    UINT32 bucket = dns_bucket(ip);
    ULONGLONG now = GetTickCount64();

    AcquireSRWLockExclusive(&g_dns_cache_lock);
    DNS_CACHE_ENTRY *e = g_dns_cache[bucket];
    while (e)
    {
        if (e->ip == ip)
        {
            strncpy_s(e->domain, sizeof(e->domain), domain, _TRUNCATE);
            e->expire_tick = now + DNS_CACHE_TTL_MS;
            ReleaseSRWLockExclusive(&g_dns_cache_lock);
            return;
        }
        e = e->next;
    }
    DNS_CACHE_ENTRY *ne = (DNS_CACHE_ENTRY *)malloc(sizeof(DNS_CACHE_ENTRY));
    if (ne)
    {
        ne->ip         = ip;
        ne->expire_tick = now + DNS_CACHE_TTL_MS;
        strncpy_s(ne->domain, sizeof(ne->domain), domain, _TRUNCATE);
        ne->next           = g_dns_cache[bucket];
        g_dns_cache[bucket] = ne;
    }
    ReleaseSRWLockExclusive(&g_dns_cache_lock);
}

BOOL dns_cache_lookup(UINT32 ip, char *out_domain, size_t out_size)
{
    UINT32 bucket = dns_bucket(ip);
    ULONGLONG now = GetTickCount64();
    BOOL found = FALSE;

    AcquireSRWLockShared(&g_dns_cache_lock);
    DNS_CACHE_ENTRY *e = g_dns_cache[bucket];
    while (e)
    {
        if (e->ip == ip && e->expire_tick > now)
        {
            strncpy_s(out_domain, out_size, e->domain, _TRUNCATE);
            found = TRUE;
            break;
        }
        e = e->next;
    }
    ReleaseSRWLockShared(&g_dns_cache_lock);
    return found;
}

UINT32 dns_bucket_v6(const UINT8 ip6[16])
{
    // FNV-1a over 16 bytes, folded to DNS_CACHE_BUCKETS
    UINT32 h = 2166136261u;
    for (int i = 0; i < 16; i++)
        h = (h ^ ip6[i]) * 16777619u;
    return h & (DNS_CACHE_BUCKETS - 1);
}

void dns_cache_store_v6(const UINT8 ip6[16], const char *domain)
{
    if (!domain || domain[0] == '\0') return;
    UINT32 bucket = dns_bucket_v6(ip6);
    ULONGLONG now = GetTickCount64();

    AcquireSRWLockExclusive(&g_dns_cache_lock);
    DNS_CACHE_ENTRY_V6 *e = g_dns_cache_v6[bucket];
    while (e)
    {
        if (memcmp(e->ip6, ip6, 16) == 0)
        {
            strncpy_s(e->domain, sizeof(e->domain), domain, _TRUNCATE);
            e->expire_tick = now + DNS_CACHE_TTL_MS;
            ReleaseSRWLockExclusive(&g_dns_cache_lock);
            return;
        }
        e = e->next;
    }
    DNS_CACHE_ENTRY_V6 *ne = (DNS_CACHE_ENTRY_V6 *)malloc(sizeof(DNS_CACHE_ENTRY_V6));
    if (ne)
    {
        memcpy(ne->ip6, ip6, 16);
        ne->expire_tick = now + DNS_CACHE_TTL_MS;
        strncpy_s(ne->domain, sizeof(ne->domain), domain, _TRUNCATE);
        ne->next = g_dns_cache_v6[bucket];
        g_dns_cache_v6[bucket] = ne;
    }
    ReleaseSRWLockExclusive(&g_dns_cache_lock);
}

BOOL dns_cache_lookup_v6(const UINT8 ip6[16], char *out_domain, size_t out_size)
{
    UINT32 bucket = dns_bucket_v6(ip6);
    ULONGLONG now = GetTickCount64();
    BOOL found = FALSE;

    AcquireSRWLockShared(&g_dns_cache_lock);
    DNS_CACHE_ENTRY_V6 *e = g_dns_cache_v6[bucket];
    while (e)
    {
        if (memcmp(e->ip6, ip6, 16) == 0 && e->expire_tick > now)
        {
            strncpy_s(out_domain, out_size, e->domain, _TRUNCATE);
            found = TRUE;
            break;
        }
        e = e->next;
    }
    ReleaseSRWLockShared(&g_dns_cache_lock);
    return found;
}

// Parse a DNS name (with pointer compression) at msg[*offset] into dst.
// Advances *offset past the name on success.
BOOL dns_parse_name(const UINT8 *msg, int msg_len, int *offset, char *dst, int dst_len)
{
    int pos    = *offset;
    int out    = 0;
    int jumps  = 0;
    BOOL jumped      = FALSE;
    int  jumped_end  = -1;

    while (pos < msg_len)
    {
        UINT8 b = msg[pos];
        if (b == 0x00)
        {
            dst[out] = '\0';
            if (!jumped) *offset = pos + 1;
            else         *offset = jumped_end;
            return TRUE;
        }
        if ((b & 0xC0) == 0xC0)
        {
            if (pos + 1 >= msg_len) return FALSE;
            if (!jumped) jumped_end = pos + 2;
            jumped = TRUE;
            pos = ((b & 0x3F) << 8) | msg[pos + 1];
            if (++jumps > 10) return FALSE;
            continue;
        }
        int label_len = (int)b;
        pos++;
        if (pos + label_len > msg_len)       return FALSE;
        if (out + label_len + 2 >= dst_len)  return FALSE;
        if (out > 0) dst[out++] = '.';
        memcpy(&dst[out], &msg[pos], label_len);
        out  += label_len;
        pos  += label_len;
    }
    return FALSE;
}

// Snoop an outbound DNS query to record (txid, qname, timestamp) for response validation (W-1).
void snoop_dns_query(const UINT8 *payload, int payload_len)
{
    if (payload == NULL || payload_len < 12) return;

    UINT16 flags = ((UINT16)payload[2] << 8) | payload[3];
    if (flags & 0x8000) return;              // QR bit set: not a query
    if (((flags >> 11) & 0x0F) != 0) return; // Opcode != 0: not a standard query

    UINT16 qdcount = ((UINT16)payload[4] << 8) | payload[5];
    if (qdcount == 0) return;

    UINT16 txid = ((UINT16)payload[0] << 8) | payload[1];
    int offset = 12;
    char qname[256];
    if (!dns_parse_name(payload, payload_len, &offset, qname, sizeof(qname))) return;
    if (qname[0] == '\0') return;
    if (offset + 4 > payload_len) return; // QTYPE + QCLASS must fit

    ULONGLONG now = GetTickCount64();

    AcquireSRWLockExclusive(&g_dns_pending_lock);

    // If already actively tracked for the exact same (txid, qname), refresh expiry on retry
    for (int i = 0; i < DNS_PENDING_QUERIES_MAX; i++)
    {
        if (g_dns_pending[i].active &&
            g_dns_pending[i].txid == txid &&
            g_dns_pending[i].expire_tick >= now &&
            _stricmp(g_dns_pending[i].qname, qname) == 0)
        {
            g_dns_pending[i].expire_tick = now + DNS_QUERY_TIMEOUT_MS;
            ReleaseSRWLockExclusive(&g_dns_pending_lock);
            return;
        }
    }

    int slot = -1;
    ULONGLONG oldest_tick = (ULONGLONG)-1;
    int oldest_idx = 0;

    for (int i = 0; i < DNS_PENDING_QUERIES_MAX; i++)
    {
        if (!g_dns_pending[i].active || g_dns_pending[i].expire_tick <= now)
        {
            slot = i;
            break;
        }
        if (g_dns_pending[i].expire_tick < oldest_tick)
        {
            oldest_tick = g_dns_pending[i].expire_tick;
            oldest_idx = i;
        }
    }
    if (slot == -1)
    {
        slot = oldest_idx; // Evict oldest active entry if ring buffer is full
    }

    g_dns_pending[slot].txid = txid;
    strncpy_s(g_dns_pending[slot].qname, sizeof(g_dns_pending[slot].qname), qname, _TRUNCATE);
    g_dns_pending[slot].expire_tick = now + DNS_QUERY_TIMEOUT_MS;
    g_dns_pending[slot].active = TRUE;
    ReleaseSRWLockExclusive(&g_dns_pending_lock);
}

// Snoop an inbound DNS response (UDP payload starting at the DNS header).
// For every A-record answer, store ip → qname in the DNS cache.
// Fix W-1: Verify that response.txid matches an active outgoing query within 5 seconds.
void snoop_dns_response(const UINT8 *payload, int payload_len)
{
    if (payload == NULL || payload_len < 12) return;

    UINT16 flags   = ((UINT16)payload[2] << 8) | payload[3];
    if (!(flags & 0x8000)) return;   // not a response
    if  (flags & 0x000F)   return;   // RCODE != NOERROR

    UINT16 qdcount = ((UINT16)payload[4] << 8) | payload[5];
    UINT16 ancount = ((UINT16)payload[6] << 8) | payload[7];
    if (qdcount == 0 || ancount == 0) return;

    int offset = 12;

    // Extract the first question's name as the canonical hostname for this answer.
    char qname[256];
    if (!dns_parse_name(payload, payload_len, &offset, qname, sizeof(qname))) return;
    if (offset + 4 > payload_len) return; // QTYPE + QCLASS
    offset += 4;  // QTYPE + QCLASS

    // Match incoming response against pending queries table by TXID (W-1)
    UINT16 txid = ((UINT16)payload[0] << 8) | payload[1];
    ULONGLONG now = GetTickCount64();
    BOOL txid_matched = FALSE;

    AcquireSRWLockExclusive(&g_dns_pending_lock);
    for (int i = 0; i < DNS_PENDING_QUERIES_MAX; i++)
    {
        if (g_dns_pending[i].active &&
            g_dns_pending[i].txid == txid &&
            g_dns_pending[i].expire_tick >= now)
        {
            if (_stricmp(g_dns_pending[i].qname, qname) == 0)
            {
                txid_matched = TRUE;
                g_dns_pending[i].active = FALSE; // Consume entry on valid match
                break;
            }
        }
    }
    ReleaseSRWLockExclusive(&g_dns_pending_lock);

    if (!txid_matched)
    {
        // Unprompted or mismatched TXID response - drop packet without caching
        return;
    }

    // Skip any remaining questions
    for (int q = 1; q < qdcount && offset < payload_len; q++)
    {
        char tmp[256];
        if (!dns_parse_name(payload, payload_len, &offset, tmp, sizeof(tmp))) return;
        offset += 4;
    }

    // Parse answer RRs
    for (int i = 0; i < ancount && offset < payload_len; i++)
    {
        char rname[256];
        if (!dns_parse_name(payload, payload_len, &offset, rname, sizeof(rname))) return;
        if (offset + 10 > payload_len) return;

        UINT16 rtype  = ((UINT16)payload[offset + 0] << 8) | payload[offset + 1];
        UINT16 rclass = ((UINT16)payload[offset + 2] << 8) | payload[offset + 3];
        UINT16 rdlen  = ((UINT16)payload[offset + 8] << 8) | payload[offset + 9];
        offset += 10;
        if (offset + rdlen > payload_len) return;

        if (rtype == 1 /* A */ && rclass == 1 /* IN */ && rdlen == 4)
        {
            UINT32 ip;
            memcpy(&ip, &payload[offset], 4);  // network-byte-order, matches ip_header->DstAddr
            dns_cache_store(ip, qname);
        }
        else if (rtype == 28 /* AAAA */ && rclass == 1 /* IN */ && rdlen == 16)
        {
            dns_cache_store_v6(&payload[offset], qname);
        }
        offset += rdlen;
    }
}

// Prune expired DNS-snoop entries (IPv4 + IPv6) so the caches don't grow without bound.
void cleanup_stale_dns_cache(void)
{
    ULONGLONG now = GetTickCount64();

    AcquireSRWLockExclusive(&g_dns_pending_lock);
    for (int i = 0; i < DNS_PENDING_QUERIES_MAX; i++)
    {
        if (g_dns_pending[i].active && g_dns_pending[i].expire_tick <= now)
        {
            g_dns_pending[i].active = FALSE;
        }
    }
    ReleaseSRWLockExclusive(&g_dns_pending_lock);

    AcquireSRWLockExclusive(&g_dns_cache_lock);
    for (int i = 0; i < DNS_CACHE_BUCKETS; i++)
    {
        DNS_CACHE_ENTRY **pp = &g_dns_cache[i];
        while (*pp != NULL)
        {
            if ((*pp)->expire_tick <= now)
            {
                DNS_CACHE_ENTRY *to_free = *pp;
                *pp = (*pp)->next;
                free(to_free);
            }
            else
            {
                pp = &(*pp)->next;
            }
        }

        DNS_CACHE_ENTRY_V6 **pp6 = &g_dns_cache_v6[i];
        while (*pp6 != NULL)
        {
            if ((*pp6)->expire_tick <= now)
            {
                DNS_CACHE_ENTRY_V6 *to_free = *pp6;
                *pp6 = (*pp6)->next;
                free(to_free);
            }
            else
            {
                pp6 = &(*pp6)->next;
            }
        }
    }
    ReleaseSRWLockExclusive(&g_dns_cache_lock);
}

// Flush the Windows DNS resolver cache so applications re-resolve hostnames on the
// wire, where our port-53 snoop can capture the IP->hostname mapping. Without this a
// domain that was resolved before a domain rule existed would have no cached mapping
// and the rule could not match. DnsFlushResolverCache is loaded dynamically so we
// avoid a hard dnsapi.lib dependency (keeps the MinGW/GCC build path unchanged).
void flush_dns_resolver_cache(void)
{
    HMODULE dnsapi = LoadLibraryA("dnsapi.dll");
    if (dnsapi == NULL)
        return;
    typedef BOOL (WINAPI *DnsFlushFn)(void);
    DnsFlushFn fn = (DnsFlushFn)GetProcAddress(dnsapi, "DnsFlushResolverCache");
    if (fn != NULL)
        fn();
    FreeLibrary(dnsapi);
}

