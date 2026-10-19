add_executable(acroclip-notifier WIN32 windows.cpp)
target_include_directories(acroclip-notifier PRIVATE ../vendor)
target_compile_definitions(acroclip-notifier PRIVATE NOMINMAX WIN32_LEAN_AND_MEAN UNICODE _UNICODE)
target_link_libraries(acroclip-notifier PRIVATE gdiplus user32 gdi32 psapi)

acroclip_brand_windows_target(acroclip-notifier "AcroClip feedback")
