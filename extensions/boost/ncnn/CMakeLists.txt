# forge-ncnn: the Boost tile worker (forge-ncnn.cpp) and the pinned ncnn it links.
# Configure with -DNCNN_SRC=<unpacked ncnn source>; build.mjs does, with ncnn's options.
cmake_minimum_required(VERSION 3.16)
project(forge-ncnn CXX C)

if(NOT NCNN_SRC)
  message(FATAL_ERROR "set -DNCNN_SRC=<ncnn source directory>")
endif()

set(CMAKE_CXX_STANDARD 11)
add_subdirectory(${NCNN_SRC} ncnn EXCLUDE_FROM_ALL)

add_executable(forge-ncnn forge-ncnn.cpp)
target_link_libraries(forge-ncnn PRIVATE ncnn)
