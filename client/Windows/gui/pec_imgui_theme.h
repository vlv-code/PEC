#pragma once

// ============================================================================
// PEC-App Modern Native GUI Theme Engine
// Dynamically matches App Studio themes (Cyber Blue, Nordic Arctic,
// Dark Obsidian, Emerald SecOps, Enterprise Light) and custom colors.
// ============================================================================

#include <algorithm>
#include <cstdio>
#include <cstdlib>
#include <cstring>
#include <string>

#if __has_include("imgui.h")
#include "imgui.h"
#elif __has_include("imgui/imgui.h")
#include "imgui/imgui.h"
#else
#include "imgui.h"
#endif

#if defined(_WIN32)
#ifndef WIN32_LEAN_AND_MEAN
#define WIN32_LEAN_AND_MEAN
#endif
#include <windows.h>
#endif

extern "C" {
#include "profile/profile.h"
}

namespace PecTheme {
    // ------------------------------------------------------------------------
    // Dynamic Theme Color Tokens (Updated by ApplyProfileTheme)
    // ------------------------------------------------------------------------
    inline ImVec4 CanvasBg       = ImVec4(0.043f, 0.067f, 0.125f, 1.000f); // Deep Canvas
    inline ImVec4 CardBg         = ImVec4(0.075f, 0.114f, 0.212f, 1.000f); // Elevated Card/Panel
    inline ImVec4 CardBgHover    = ImVec4(0.094f, 0.141f, 0.255f, 1.000f);
    inline ImVec4 FrameBg        = ImVec4(0.118f, 0.161f, 0.231f, 1.000f); // Inputs / Checkboxes
    inline ImVec4 FrameBgHover   = ImVec4(0.150f, 0.205f, 0.295f, 1.000f);
    inline ImVec4 FrameBgActive  = ImVec4(0.180f, 0.245f, 0.350f, 1.000f);

    inline ImVec4 PrimaryAccent  = ImVec4(0.008f, 0.518f, 0.780f, 1.000f); // Primary accent
    inline ImVec4 HoverAccent    = ImVec4(0.220f, 0.741f, 0.973f, 1.000f); // Hover highlight
    inline ImVec4 ActiveAccent   = ImVec4(0.055f, 0.647f, 0.914f, 1.000f); // Active / Focused

    inline ImVec4 BorderColor    = ImVec4(0.118f, 0.161f, 0.231f, 1.000f);
    inline ImVec4 BorderLight    = ImVec4(0.200f, 0.260f, 0.360f, 0.600f);

    inline ImVec4 TextPrimary    = ImVec4(0.973f, 0.980f, 0.988f, 1.000f);
    inline ImVec4 TextSecondary  = ImVec4(0.580f, 0.639f, 0.722f, 1.000f);
    inline ImVec4 TextMuted      = TextSecondary;
    inline ImVec4 TextDisabled   = ImVec4(0.380f, 0.430f, 0.500f, 1.000f);

    inline ImVec4 SuccessColor   = ImVec4(0.063f, 0.725f, 0.506f, 1.000f); // #10B981
    inline ImVec4 SuccessDirect  = SuccessColor;
    inline ImVec4 WarningColor   = ImVec4(0.961f, 0.620f, 0.043f, 1.000f); // #F59E0B
    inline ImVec4 WarningAlert   = WarningColor;
    inline ImVec4 DangerColor    = ImVec4(0.937f, 0.267f, 0.267f, 1.000f); // #EF4444
    inline ImVec4 DangerRed      = DangerColor;

    inline bool   IsLightMode    = false;
}

// ----------------------------------------------------------------------------
// Helper: Convert COLORREF (Win32 RGB) to ImVec4
// ----------------------------------------------------------------------------
inline ImVec4 ColorrefToImVec4(COLORREF cr, float alpha = 1.0f)
{
    return ImVec4(GetRValue(cr) / 255.0f, GetGValue(cr) / 255.0f, GetBValue(cr) / 255.0f, alpha);
}

// ----------------------------------------------------------------------------
// ApplyProfileTheme: Read PBProfile theme settings and configure ImGui style
// ----------------------------------------------------------------------------
inline void ApplyProfileTheme(const PBProfile* prof, ImGuiStyle* dst = nullptr)
{
    ImGuiStyle& style = dst ? *dst : ImGui::GetStyle();

    std::string preset = "cyber-blue";
    std::string mode = "dark";
    std::string layout = "console";

    if (prof && prof->theme.hasTheme) {
        char pBuf[64] = {0}, mBuf[32] = {0}, lBuf[32] = {0};
        WideCharToMultiByte(CP_UTF8, 0, prof->theme.preset, -1, pBuf, sizeof(pBuf), NULL, NULL);
        WideCharToMultiByte(CP_UTF8, 0, prof->theme.mode, -1, mBuf, sizeof(mBuf), NULL, NULL);
        WideCharToMultiByte(CP_UTF8, 0, prof->theme.layout, -1, lBuf, sizeof(lBuf), NULL, NULL);
        if (pBuf[0]) preset = pBuf;
        if (mBuf[0]) mode = mBuf;
        if (lBuf[0]) layout = lBuf;
    }

    PecTheme::IsLightMode = (mode == "light" || preset == "enterprise-light" || preset == "minimal-light" || preset == "light");

    if (preset == "nordic-arctic" || preset == "nord") {
        // Nordic Arctic (Matches Screenshot 2)
        PecTheme::CanvasBg      = ImVec4(0.141f, 0.161f, 0.200f, 1.0f); // #242933
        PecTheme::CardBg        = ImVec4(0.180f, 0.204f, 0.251f, 1.0f); // #2e3440
        PecTheme::CardBgHover   = ImVec4(0.231f, 0.259f, 0.322f, 1.0f); // #3b4252
        PecTheme::FrameBg       = ImVec4(0.231f, 0.259f, 0.322f, 1.0f); // #3b4252
        PecTheme::FrameBgHover  = ImVec4(0.263f, 0.302f, 0.373f, 1.0f); // #434c5e
        PecTheme::FrameBgActive = ImVec4(0.298f, 0.341f, 0.416f, 1.0f); // #4c566a
        PecTheme::PrimaryAccent = ImVec4(0.533f, 0.753f, 0.816f, 1.0f); // #88c0d0 Ice Blue
        PecTheme::HoverAccent   = ImVec4(0.506f, 0.631f, 0.757f, 1.0f); // #81a1c1
        PecTheme::ActiveAccent  = ImVec4(0.369f, 0.506f, 0.675f, 1.0f); // #5e81ac
        PecTheme::BorderColor   = ImVec4(0.298f, 0.341f, 0.416f, 1.0f); // #4c566a
        PecTheme::BorderLight   = ImVec4(0.298f, 0.341f, 0.416f, 0.6f);
        PecTheme::TextPrimary   = ImVec4(0.925f, 0.937f, 0.957f, 1.0f); // #eceff4
        PecTheme::TextSecondary = ImVec4(0.847f, 0.871f, 0.914f, 1.0f); // #d8dee9
        PecTheme::TextMuted     = PecTheme::TextSecondary;
    }
    else if (preset == "dark-obsidian" || preset == "obsidian") {
        // Dark Obsidian
        PecTheme::CanvasBg      = ImVec4(0.051f, 0.067f, 0.090f, 1.0f); // #0d1117
        PecTheme::CardBg        = ImVec4(0.086f, 0.106f, 0.133f, 1.0f); // #161b22
        PecTheme::CardBgHover   = ImVec4(0.129f, 0.149f, 0.176f, 1.0f); // #21262d
        PecTheme::FrameBg       = ImVec4(0.129f, 0.149f, 0.176f, 1.0f); // #21262d
        PecTheme::FrameBgHover  = ImVec4(0.188f, 0.212f, 0.239f, 1.0f); // #30363d
        PecTheme::FrameBgActive = ImVec4(0.235f, 0.263f, 0.290f, 1.0f);
        PecTheme::PrimaryAccent = ImVec4(0.753f, 0.518f, 0.988f, 1.0f); // #c084fc Purple
        PecTheme::HoverAccent   = ImVec4(0.847f, 0.706f, 0.996f, 1.0f); // #d8b4fe
        PecTheme::ActiveAccent  = ImVec4(0.659f, 0.333f, 0.969f, 1.0f); // #a855f7
        PecTheme::BorderColor   = ImVec4(0.188f, 0.212f, 0.239f, 1.0f); // #30363d
        PecTheme::BorderLight   = ImVec4(0.188f, 0.212f, 0.239f, 0.6f);
        PecTheme::TextPrimary   = ImVec4(0.941f, 0.965f, 0.988f, 1.0f); // #f0f6fc
        PecTheme::TextSecondary = ImVec4(0.545f, 0.580f, 0.620f, 1.0f); // #8b949e
        PecTheme::TextMuted     = PecTheme::TextSecondary;
    }
    else if (preset == "emerald-secops" || preset == "emerald" || preset == "emerald-sentinel") {
        // Emerald SecOps / Emerald Sentinel
        PecTheme::CanvasBg      = ImVec4(0.024f, 0.075f, 0.051f, 1.0f); // #06130d
        PecTheme::CardBg        = ImVec4(0.043f, 0.122f, 0.086f, 1.0f); // #0b1f16
        PecTheme::CardBgHover   = ImVec4(0.067f, 0.180f, 0.129f, 1.0f); // #112e21
        PecTheme::FrameBg       = ImVec4(0.067f, 0.180f, 0.129f, 1.0f); // #112e21
        PecTheme::FrameBgHover  = ImVec4(0.075f, 0.227f, 0.165f, 1.0f); // #133a2a
        PecTheme::FrameBgActive = ImVec4(0.090f, 0.275f, 0.200f, 1.0f);
        PecTheme::PrimaryAccent = ImVec4(0.204f, 0.827f, 0.600f, 1.0f); // #34d399 Emerald
        PecTheme::HoverAccent   = ImVec4(0.431f, 0.906f, 0.718f, 1.0f); // #6ee7b7
        PecTheme::ActiveAccent  = ImVec4(0.063f, 0.725f, 0.506f, 1.0f); // #10b981
        PecTheme::BorderColor   = ImVec4(0.075f, 0.227f, 0.165f, 1.0f); // #133a2a
        PecTheme::BorderLight   = ImVec4(0.075f, 0.227f, 0.165f, 0.6f);
        PecTheme::TextPrimary   = ImVec4(0.925f, 0.992f, 0.961f, 1.0f); // #ecfdf5
        PecTheme::TextSecondary = ImVec4(0.431f, 0.906f, 0.718f, 1.0f); // #6ee7b7
        PecTheme::TextMuted     = PecTheme::TextSecondary;
    }
    else if (preset == "sunset-amber" || preset == "amber") {
        // Sunset Amber
        PecTheme::CanvasBg      = ImVec4(0.110f, 0.075f, 0.027f, 1.0f); // #1c1307
        PecTheme::CardBg        = ImVec4(0.149f, 0.094f, 0.020f, 1.0f); // #261805
        PecTheme::CardBgHover   = ImVec4(0.200f, 0.130f, 0.035f, 1.0f);
        PecTheme::FrameBg       = ImVec4(0.200f, 0.130f, 0.035f, 1.0f);
        PecTheme::FrameBgHover  = ImVec4(0.250f, 0.165f, 0.045f, 1.0f);
        PecTheme::FrameBgActive = ImVec4(0.300f, 0.200f, 0.055f, 1.0f);
        PecTheme::PrimaryAccent = ImVec4(0.961f, 0.620f, 0.043f, 1.0f); // #f59e0b Amber
        PecTheme::HoverAccent   = ImVec4(0.984f, 0.749f, 0.141f, 1.0f); // #fbbf24
        PecTheme::ActiveAccent  = ImVec4(0.851f, 0.467f, 0.024f, 1.0f); // #d97706
        PecTheme::BorderColor   = ImVec4(0.471f, 0.208f, 0.059f, 1.0f); // #78350f
        PecTheme::BorderLight   = ImVec4(0.471f, 0.208f, 0.059f, 0.6f);
        PecTheme::TextPrimary   = ImVec4(0.996f, 0.953f, 0.780f, 1.0f); // #fef3c7
        PecTheme::TextSecondary = ImVec4(0.992f, 0.902f, 0.541f, 1.0f); // #fde68a
        PecTheme::TextMuted     = PecTheme::TextSecondary;
    }
    else if (PecTheme::IsLightMode) {
        // Enterprise Light
        PecTheme::CanvasBg      = ImVec4(0.945f, 0.961f, 0.976f, 1.0f); // #f1f5f9
        PecTheme::CardBg        = ImVec4(1.000f, 1.000f, 1.000f, 1.0f); // #ffffff
        PecTheme::CardBgHover   = ImVec4(0.965f, 0.976f, 0.988f, 1.0f);
        PecTheme::FrameBg       = ImVec4(0.886f, 0.910f, 0.941f, 1.0f); // #e2e8f0
        PecTheme::FrameBgHover  = ImVec4(0.796f, 0.835f, 0.882f, 1.0f); // #cbd5e1
        PecTheme::FrameBgActive = ImVec4(0.682f, 0.741f, 0.804f, 1.0f);
        PecTheme::PrimaryAccent = ImVec4(0.145f, 0.388f, 0.922f, 1.0f); // #2563eb Blue
        PecTheme::HoverAccent   = ImVec4(0.231f, 0.510f, 0.965f, 1.0f); // #3b82f6
        PecTheme::ActiveAccent  = ImVec4(0.114f, 0.306f, 0.847f, 1.0f); // #1d4ed8
        PecTheme::BorderColor   = ImVec4(0.796f, 0.835f, 0.882f, 1.0f); // #cbd5e1
        PecTheme::BorderLight   = ImVec4(0.796f, 0.835f, 0.882f, 0.6f);
        PecTheme::TextPrimary   = ImVec4(0.059f, 0.090f, 0.165f, 1.0f); // #0f172a
        PecTheme::TextSecondary = ImVec4(0.392f, 0.455f, 0.545f, 1.0f); // #64748b
        PecTheme::TextMuted     = PecTheme::TextSecondary;
    }
    else {
        // Default Cyber Blue
        PecTheme::CanvasBg      = ImVec4(0.043f, 0.067f, 0.125f, 1.0f); // #0B1120
        PecTheme::CardBg        = ImVec4(0.075f, 0.114f, 0.212f, 1.0f); // #131D36
        PecTheme::CardBgHover   = ImVec4(0.094f, 0.141f, 0.255f, 1.0f);
        PecTheme::FrameBg       = ImVec4(0.118f, 0.161f, 0.231f, 1.0f); // #1E293B
        PecTheme::FrameBgHover  = ImVec4(0.150f, 0.205f, 0.295f, 1.0f);
        PecTheme::FrameBgActive = ImVec4(0.180f, 0.245f, 0.350f, 1.0f);
        PecTheme::PrimaryAccent = ImVec4(0.008f, 0.518f, 0.780f, 1.0f); // #0284C7
        PecTheme::HoverAccent   = ImVec4(0.220f, 0.741f, 0.973f, 1.0f); // #38BDF8
        PecTheme::ActiveAccent  = ImVec4(0.055f, 0.647f, 0.914f, 1.0f); // #0EA5E9
        PecTheme::BorderColor   = ImVec4(0.118f, 0.161f, 0.231f, 1.0f); // #1E293B
        PecTheme::BorderLight   = ImVec4(0.200f, 0.260f, 0.360f, 0.6f);
        PecTheme::TextPrimary   = ImVec4(0.973f, 0.980f, 0.988f, 1.0f); // #F8FAFC
        PecTheme::TextSecondary = ImVec4(0.580f, 0.639f, 0.722f, 1.0f); // #94A3B8
        PecTheme::TextMuted     = PecTheme::TextSecondary;
    }

    // Override with custom RGB values if provided in profile
    if (prof && prof->theme.hasTheme) {
        if (prof->theme.primary) {
            PecTheme::PrimaryAccent = ColorrefToImVec4(prof->theme.primary);
            PecTheme::HoverAccent   = ImVec4(
                (std::min)(1.0f, PecTheme::PrimaryAccent.x * 1.25f + 0.05f),
                (std::min)(1.0f, PecTheme::PrimaryAccent.y * 1.25f + 0.05f),
                (std::min)(1.0f, PecTheme::PrimaryAccent.z * 1.25f + 0.05f),
                1.0f
            );
            PecTheme::ActiveAccent  = ImVec4(
                PecTheme::PrimaryAccent.x * 0.85f,
                PecTheme::PrimaryAccent.y * 0.85f,
                PecTheme::PrimaryAccent.z * 0.85f,
                1.0f
            );
        }
        if (prof->theme.background) PecTheme::CanvasBg      = ColorrefToImVec4(prof->theme.background);
        if (prof->theme.card)       PecTheme::CardBg        = ColorrefToImVec4(prof->theme.card);
    }

    // Apply colors to Dear ImGui
    ImVec4* colors = style.Colors;
    colors[ImGuiCol_Text]                  = PecTheme::TextPrimary;
    colors[ImGuiCol_TextDisabled]          = PecTheme::TextDisabled;
    colors[ImGuiCol_WindowBg]              = PecTheme::CanvasBg;
    colors[ImGuiCol_ChildBg]               = PecTheme::CardBg;
    colors[ImGuiCol_PopupBg]               = PecTheme::CardBg;
    colors[ImGuiCol_Border]                = PecTheme::BorderColor;
    colors[ImGuiCol_BorderShadow]          = ImVec4(0, 0, 0, 0);

    colors[ImGuiCol_FrameBg]               = PecTheme::FrameBg;
    colors[ImGuiCol_FrameBgHovered]        = PecTheme::FrameBgHover;
    colors[ImGuiCol_FrameBgActive]         = PecTheme::FrameBgActive;

    colors[ImGuiCol_TitleBg]               = PecTheme::CanvasBg;
    colors[ImGuiCol_TitleBgActive]         = PecTheme::CardBg;
    colors[ImGuiCol_TitleBgCollapsed]      = PecTheme::CanvasBg;
    colors[ImGuiCol_MenuBarBg]             = PecTheme::CanvasBg;

    colors[ImGuiCol_ScrollbarBg]           = PecTheme::CanvasBg;
    colors[ImGuiCol_ScrollbarGrab]         = PecTheme::FrameBg;
    colors[ImGuiCol_ScrollbarGrabHovered]  = PecTheme::HoverAccent;
    colors[ImGuiCol_ScrollbarGrabActive]   = PecTheme::ActiveAccent;

    colors[ImGuiCol_CheckMark]             = PecTheme::ActiveAccent;
    colors[ImGuiCol_SliderGrab]            = PecTheme::PrimaryAccent;
    colors[ImGuiCol_SliderGrabActive]      = PecTheme::ActiveAccent;
    colors[ImGuiCol_Button]                = PecTheme::PrimaryAccent;
    colors[ImGuiCol_ButtonHovered]         = PecTheme::HoverAccent;
    colors[ImGuiCol_ButtonActive]          = PecTheme::ActiveAccent;

    colors[ImGuiCol_Header]                = ImVec4(PecTheme::CardBg.x, PecTheme::CardBg.y, PecTheme::CardBg.z, 0.8f);
    colors[ImGuiCol_HeaderHovered]         = ImVec4(PecTheme::PrimaryAccent.x, PecTheme::PrimaryAccent.y, PecTheme::PrimaryAccent.z, 0.35f);
    colors[ImGuiCol_HeaderActive]          = ImVec4(PecTheme::PrimaryAccent.x, PecTheme::PrimaryAccent.y, PecTheme::PrimaryAccent.z, 0.60f);

    colors[ImGuiCol_Separator]             = PecTheme::BorderColor;
    colors[ImGuiCol_SeparatorHovered]      = PecTheme::HoverAccent;
    colors[ImGuiCol_SeparatorActive]       = PecTheme::ActiveAccent;

    colors[ImGuiCol_Tab]                   = PecTheme::CardBg;
    colors[ImGuiCol_TabHovered]            = PecTheme::HoverAccent;
    colors[ImGuiCol_TabSelected]           = PecTheme::PrimaryAccent;
    colors[ImGuiCol_TabSelectedOverline]   = PecTheme::HoverAccent;
    colors[ImGuiCol_TabDimmed]             = PecTheme::CanvasBg;
    colors[ImGuiCol_TabDimmedSelected]     = ImVec4(PecTheme::PrimaryAccent.x, PecTheme::PrimaryAccent.y, PecTheme::PrimaryAccent.z, 0.7f);
    colors[ImGuiCol_TabDimmedSelectedOverline] = PecTheme::ActiveAccent;

    colors[ImGuiCol_TableHeaderBg]         = PecTheme::FrameBg;
    colors[ImGuiCol_TableBorderStrong]     = PecTheme::BorderColor;
    colors[ImGuiCol_TableBorderLight]      = PecTheme::BorderLight;
    colors[ImGuiCol_TableRowBg]            = ImVec4(0, 0, 0, 0);
    colors[ImGuiCol_TableRowBgAlt]         = ImVec4(1, 1, 1, 0.02f);

    // Layout Metrics (Console/Terminal geometry)
    if (layout == "terminal" || layout == "sharp") {
        style.WindowRounding    = 0.0f;
        style.ChildRounding     = 0.0f;
        style.FrameRounding     = 0.0f;
        style.PopupRounding     = 0.0f;
        style.TabRounding       = 0.0f;
        style.ScrollbarRounding = 0.0f;
        style.GrabRounding      = 0.0f;
    } else {
        style.WindowRounding    = 8.0f;
        style.ChildRounding     = 6.0f;
        style.FrameRounding     = 6.0f;
        style.PopupRounding     = 6.0f;
        style.TabRounding       = 6.0f;
        style.ScrollbarRounding = 4.0f;
        style.GrabRounding      = 4.0f;
    }

    style.WindowBorderSize  = 1.0f;
    style.ChildBorderSize   = 1.0f;
    style.PopupBorderSize   = 1.0f;
    style.FrameBorderSize   = 1.0f;
    style.TabBorderSize     = 0.0f;
    style.TabBarBorderSize  = 1.0f;

    style.WindowPadding     = ImVec2(16.0f, 16.0f);
    style.FramePadding      = ImVec2(10.0f, 6.0f);
    style.ItemSpacing       = ImVec2(8.0f, 8.0f);
    style.ItemInnerSpacing  = ImVec2(6.0f, 6.0f);
    style.CellPadding       = ImVec2(8.0f, 6.0f);
    style.ScrollbarSize     = 12.0f;
    style.GrabMinSize       = 10.0f;
}

inline void SetupCyberBlueTheme(ImGuiStyle* dst = nullptr)
{
    ApplyProfileTheme(nullptr, dst);
}

// ----------------------------------------------------------------------------
// Glyph Ranges & Font Loading
// ----------------------------------------------------------------------------
inline const ImWchar* GetCyberBlueGlyphRanges()
{
    static const ImWchar ranges[] = {
        0x0020, 0x00FF, // Basic Latin + Latin Supplement
        0x0400, 0x052F, // Cyrillic + Cyrillic Supplement
        0x2000, 0x206F, // General Punctuation
        0x2100, 0x214F, // Letterlike Symbols
        0x2190, 0x21FF, // Arrows
        0x2200, 0x22FF, // Mathematical Operators
        0x2300, 0x23FF, // Miscellaneous Technical
        0x25A0, 0x25FF, // Geometric Shapes
        0x2700, 0x27BF, // Dingbats
        0x2DE0, 0x2DFF, // Cyrillic Extended-A
        0xA640, 0xA69F, // Cyrillic Extended-B
        0,
    };
    return ranges;
}

inline ImFont* LoadCyberBlueFont(ImGuiIO& io, float size_pixels = 16.0f)
{
    ImFontConfig config;
    config.OversampleH = 2;
    config.OversampleV = 2;

    const ImWchar* glyph_ranges = GetCyberBlueGlyphRanges();

    char fonts_dir[512] = {0};
#if defined(_WIN32)
    char win_dir[MAX_PATH] = {0};
    if (GetWindowsDirectoryA(win_dir, MAX_PATH) > 0) {
        snprintf(fonts_dir, sizeof(fonts_dir), "%s\\Fonts", win_dir);
    }
#endif
    if (fonts_dir[0] == '\0') {
        const char* env_windir = getenv("WINDIR");
        if (!env_windir) env_windir = getenv("SystemRoot");
        if (env_windir && env_windir[0] != '\0') {
            snprintf(fonts_dir, sizeof(fonts_dir), "%s\\Fonts", env_windir);
        } else {
            snprintf(fonts_dir, sizeof(fonts_dir), "C:\\Windows\\Fonts");
        }
    }

    const char* font_names[] = {
        "segoeui.ttf",
        "tahoma.ttf",
        "arial.ttf"
    };

    char full_path[1024];
    for (const char* name : font_names) {
        snprintf(full_path, sizeof(full_path), "%s\\%s", fonts_dir, name);

        FILE* f = nullptr;
#if defined(_MSC_VER) && _MSC_VER >= 1400
        if (fopen_s(&f, full_path, "rb") == 0 && f) {
            fclose(f);
            return io.Fonts->AddFontFromFileTTF(full_path, size_pixels, &config, glyph_ranges);
        }
#else
        f = fopen(full_path, "rb");
        if (f) {
            fclose(f);
            return io.Fonts->AddFontFromFileTTF(full_path, size_pixels, &config, glyph_ranges);
        }
#endif
    }

    return io.Fonts->AddFontDefault();
}
