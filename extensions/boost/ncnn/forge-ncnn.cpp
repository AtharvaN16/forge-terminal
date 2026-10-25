// forge-ncnn — the Boost extension's tile worker for Linux.
//
// Runs realesr-general-x4v3 (SRVGGNetCompact, always 4x) over one 256 px tile
// at a time through ncnn, on the CPU or on a Vulkan device. It knows nothing of
// images: runner.mjs cuts the tiles, brings them to the factor asked for, and
// writes the PNG. This file only turns a tile into its 4x version.
//
//   forge-ncnn --devices
//       One line of JSON on stdout: the Vulkan devices ncnn can see, each with
//       its index, name and kind. An empty list if there is no Vulkan loader or
//       driver; never an error. Which one to use is runner.mjs's decision (it
//       turns away a software "graphics card" by its name), made before the
//       worker is started.
//
//   forge-ncnn --param <file> --bin <file> [--gpu <index>] [--threads <n>] [--fp32]
//       Loads the model, answers with one line of JSON on stdout
//       ({"ready":true,"device":"cpu"|<name>,"threads":n}), then serves tiles
//       until stdin closes:
//         in:  256 x 256 x 3 bytes, RGB, row by row                      (196,608)
//         out: 3 x 1024 x 1024 float32, one plane each, 0..1 (not clamped) (12,582,912)
//       No --gpu means the CPU. A GPU that will not start is an error (exit 2,
//       the reason on stderr), not a silent CPU run: the caller decides what to do.
//       --fp32 keeps the CPU to 32-bit arithmetic (slower; for checking the half-precision one).
//
// stdout carries nothing else once serving; every message is on stderr.

#include <stdint.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>

#include <atomic>
#include <condition_variable>
#include <deque>
#include <mutex>
#include <string>
#include <thread>
#include <vector>
#include <unistd.h>

#include "cpu.h"
#include "gpu.h"
#include "mat.h"
#include "net.h"

static const int TILE = 256;
static const int SCALE = 4;
static const int OUT = TILE * SCALE;

static std::string json_escape(const char* s)
{
    std::string out;
    for (; *s; s++)
    {
        unsigned char c = (unsigned char)*s;
        if (c == '"' || c == '\\')
        {
            out += '\\';
            out += (char)c;
        }
        else if (c < 0x20)
            out += ' ';
        else
            out += (char)c;
    }
    return out;
}

// A queue between two threads that holds at most `limit` items; close() lets everything
// waiting go, and pop() still hands out what was queued before the close.
template<typename T>
class Channel
{
public:
    explicit Channel(size_t limit)
        : limit_(limit), closed_(false)
    {
    }

    bool push(T&& item)
    {
        std::unique_lock<std::mutex> lock(m_);
        not_full_.wait(lock, [&]() { return closed_ || q_.size() < limit_; });
        if (closed_)
            return false;
        q_.push_back(std::move(item));
        not_empty_.notify_one();
        return true;
    }

    bool pop(T& item)
    {
        std::unique_lock<std::mutex> lock(m_);
        not_empty_.wait(lock, [&]() { return closed_ || !q_.empty(); });
        if (q_.empty())
            return false;
        item = std::move(q_.front());
        q_.pop_front();
        not_full_.notify_one();
        return true;
    }

    void close()
    {
        std::lock_guard<std::mutex> lock(m_);
        closed_ = true;
        not_empty_.notify_all();
        not_full_.notify_all();
    }

private:
    size_t limit_;
    bool closed_;
    std::deque<T> q_;
    std::mutex m_;
    std::condition_variable not_full_;
    std::condition_variable not_empty_;
};

static bool read_exact(FILE* f, void* buf, size_t n)
{
    return fread(buf, 1, n, f) == n;
}

#if NCNN_VULKAN
static const char* kind_of(int type)
{
    // VkPhysicalDeviceType, as ncnn reports it.
    switch (type)
    {
    case 0:
        return "discrete";
    case 1:
        return "integrated";
    case 2:
        return "virtual";
    case 3:
        return "cpu";
    default:
        return "other";
    }
}

static int list_devices()
{
    std::string line = "{\"devices\":[";
    if (ncnn::create_gpu_instance() == 0)
    {
        const int n = ncnn::get_gpu_count();
        for (int i = 0; i < n; i++)
        {
            const ncnn::GpuInfo& info = ncnn::get_gpu_info(i);
            if (i) line += ",";
            line += "{\"index\":" + std::to_string(i);
            line += ",\"name\":\"" + json_escape(info.device_name()) + "\"";
            line += ",\"kind\":\"" + std::string(kind_of(info.type())) + "\"}";
        }
        ncnn::destroy_gpu_instance();
    }
    line += "]}\n";
    fputs(line.c_str(), stdout);
    return 0;
}
#else
static int list_devices()
{
    fputs("{\"devices\":[]}\n", stdout);
    return 0;
}
#endif

int main(int argc, char** argv)
{
    const char* param = 0;
    const char* bin = 0;
    int gpu = -1;
    int threads = 0;
    bool fp32 = false;

    for (int i = 1; i < argc; i++)
    {
        const char* a = argv[i];
        if (!strcmp(a, "--devices"))
            return list_devices();
        if (!strcmp(a, "--fp32"))
        {
            fp32 = true;
            continue;
        }
        if (i + 1 >= argc)
        {
            fprintf(stderr, "forge-ncnn: %s needs a value\n", a);
            return 2;
        }
        if (!strcmp(a, "--param"))
            param = argv[++i];
        else if (!strcmp(a, "--bin"))
            bin = argv[++i];
        else if (!strcmp(a, "--gpu"))
            gpu = atoi(argv[++i]);
        else if (!strcmp(a, "--threads"))
            threads = atoi(argv[++i]);
        else
        {
            fprintf(stderr, "forge-ncnn: unknown argument %s\n", a);
            return 2;
        }
    }
    if (!param || !bin)
    {
        fprintf(stderr, "usage: forge-ncnn --devices | --param <file> --bin <file> [--gpu <index>] [--threads <n>]\n");
        return 2;
    }

    ncnn::Net net;
    std::string device = "cpu";

#if NCNN_VULKAN
    if (gpu >= 0)
    {
        if (ncnn::create_gpu_instance() != 0 || gpu >= ncnn::get_gpu_count())
        {
            fprintf(stderr, "forge-ncnn: Vulkan device %d is not available\n", gpu);
            return 2;
        }
        net.set_vulkan_device(gpu);
        net.opt.use_vulkan_compute = true;
        device = ncnn::get_gpu_info(gpu).device_name();
    }
#else
    if (gpu >= 0)
    {
        fprintf(stderr, "forge-ncnn: built without Vulkan\n");
        return 2;
    }
#endif

    // The processor's own big cores: the little ones of a big.LITTLE chip slow a
    // tile down more than they help (measured). ncnn's count is what it found.
    if (threads <= 0)
        threads = ncnn::get_big_cpu_count();
    if (threads <= 0)
        threads = 1;
    net.opt.num_threads = threads;
    // ncnn picks the fastest arithmetic the chip has (fp16 on ARMv8.2, AVX/FMA on
    // x64) at run time; these just do not turn it off.
    if (!fp32 || gpu >= 0)
    {
        net.opt.use_fp16_packed = true;
        net.opt.use_fp16_storage = true;
        net.opt.use_fp16_arithmetic = true;
    }
    else
    {
        net.opt.use_fp16_packed = false;
        net.opt.use_fp16_storage = false;
        net.opt.use_fp16_arithmetic = false;
    }

    if (net.load_param(param) != 0 || net.load_model(bin) != 0)
    {
        fprintf(stderr, "forge-ncnn: cannot load the model %s / %s\n", param, bin);
        return 2;
    }

    printf("{\"ready\":true,\"device\":\"%s\",\"threads\":%d}\n", json_escape(device.c_str()).c_str(), threads);
    fflush(stdout);

    // Three threads: one reads tiles from the runner as they arrive, this one runs the model, one writes
    // the answers back. A pipe holds only 64 KB, so a tile is not "sent" until it has been read all the
    // way; with the reading and writing done on their own, the model never waits for the runner (which
    // is busy bringing the last tile to size) to get round to its end of the pipe.
    Channel<std::vector<unsigned char> > tiles(4);
    Channel<std::vector<float> > answers(2);
    std::atomic<bool> runner_gone(false);

    std::thread reader([&]() {
        for (;;)
        {
            std::vector<unsigned char> in((size_t)TILE * TILE * 3);
            if (!read_exact(stdin, in.data(), in.size()))
                break; // the runner closed the pipe: done
            if (!tiles.push(std::move(in)))
                break;
        }
        tiles.close();
    });

    std::thread writer([&]() {
        std::vector<float> out;
        while (answers.pop(out))
        {
            if (fwrite(out.data(), sizeof(float), out.size(), stdout) != out.size())
            {
                runner_gone = true; // the runner went away
                tiles.close();
                answers.close();
                return;
            }
            fflush(stdout);
        }
    });

    int code = 0;
    std::vector<unsigned char> in;
    while (tiles.pop(in))
    {
        // 0..255 bytes to 0..1 floats, one plane per channel (by hand: ncnn's own helpers
        // are layers, and this build has only the ones the model needs).
        ncnn::Mat x(TILE, TILE, 3);
        for (int c = 0; c < 3; c++)
        {
            float* p = x.channel(c);
            for (int i = 0; i < TILE * TILE; i++)
                p[i] = in[i * 3 + c] * (1.f / 255.f);
        }

        ncnn::Extractor ex = net.create_extractor();
        ex.input("data", x);
        ncnn::Mat y;
        if (ex.extract("output", y) != 0 || y.w != OUT || y.h != OUT || y.c != 3)
        {
            fprintf(stderr, "forge-ncnn: the model did not produce a tile\n");
            code = 3;
            break;
        }

        std::vector<float> out((size_t)3 * OUT * OUT);
        for (int c = 0; c < 3; c++)
            memcpy(out.data() + (size_t)c * OUT * OUT, y.channel(c), sizeof(float) * (size_t)OUT * OUT);
        if (!answers.push(std::move(out)))
            break; // the writer gave up: the runner is gone
    }

    tiles.close();
    answers.close(); // the writer finishes what is queued, then ends
    writer.join();
    if (code != 0 || runner_gone)
        _exit(code); // the reader may be blocked in fread on a pipe nobody will fill
    // The runner closed its end: the reader has ended too.
    reader.join();

#if NCNN_VULKAN
    net.clear();
    if (gpu >= 0)
        ncnn::destroy_gpu_instance();
#endif
    return 0;
}
