cmake_minimum_required(VERSION 3.24)
project(attaclip_wasapi_health LANGUAGES CXX)
set(CMAKE_CXX_STANDARD 17)
set(CMAKE_CXX_STANDARD_REQUIRED ON)
set(OBS_SOURCE_DIR "" CACHE PATH "Exact pinned OBS source")
set(OBS_IMPORT_LIBRARY "" CACHE FILEPATH "Matching OBS import library")
set(OBS_GENERATED_DIR "" CACHE PATH "Verified OBS configuration headers")
set(WASAPI_SOURCE_DIR "" CACHE PATH "Exact patched module inputs")
foreach(input OBS_SOURCE_DIR OBS_GENERATED_DIR WASAPI_SOURCE_DIR)
  if(NOT IS_DIRECTORY "${${input}}")
    message(FATAL_ERROR "Provide ${input}")
  endif()
endforeach()
if(NOT EXISTS "${OBS_IMPORT_LIBRARY}" OR NOT EXISTS "${OBS_GENERATED_DIR}/obsconfig.h")
  message(FATAL_ERROR "Provide the matching OBS import library and configuration")
endif()
add_library(win-wasapi MODULE
  "${WASAPI_SOURCE_DIR}/win-wasapi.cpp"
  "${WASAPI_SOURCE_DIR}/wasapi-notify.cpp"
  "${WASAPI_SOURCE_DIR}/wasapi-notify.hpp"
  "${WASAPI_SOURCE_DIR}/enum-wasapi.cpp"
  "${WASAPI_SOURCE_DIR}/enum-wasapi.hpp"
  "${WASAPI_SOURCE_DIR}/plugin-main.cpp")
target_include_directories(win-wasapi PRIVATE
  "${OBS_SOURCE_DIR}/libobs"
  "${OBS_SOURCE_DIR}/deps/w32-pthreads"
  "${OBS_GENERATED_DIR}")
target_compile_definitions(win-wasapi PRIVATE NOMINMAX UNICODE _UNICODE)
target_compile_options(win-wasapi PRIVATE /showIncludes)
target_link_libraries(win-wasapi PRIVATE "${OBS_IMPORT_LIBRARY}" Avrt Ole32 User32 UUID)
set_target_properties(win-wasapi PROPERTIES PREFIX "")
