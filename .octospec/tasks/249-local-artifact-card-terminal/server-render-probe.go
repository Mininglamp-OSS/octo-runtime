// 从 octo-server 根目录显式 go build 此文件；只读使用其生产模板与最终校验。
package main

import (
	"bufio"
	"context"
	"encoding/json"
	"fmt"
	"github.com/Mininglamp-OSS/octo-server/pkg/cardtmpl"
	reasoning "github.com/Mininglamp-OSS/octo-server/pkg/cardtmpl/ai_reasoning_process"
	"os"
)

func main() {
	registry := cardtmpl.NewRegistry()
	registry.RegisterJSON(reasoning.Assets, reasoning.HandoffRootV4)
	registry.RegisterJSON(reasoning.Assets, reasoning.HandoffRootV5)
	registry.Freeze()
	scanner := bufio.NewScanner(os.Stdin)
	scanner.Buffer(make([]byte, 4096), 1<<20)
	for scanner.Scan() {
		var request struct {
			Version string          `json:"version"`
			State   cardtmpl.State  `json:"state"`
			Data    json.RawMessage `json:"data"`
		}
		if err := json.Unmarshal(scanner.Bytes(), &request); err != nil {
			panic(err)
		}
		_, err := registry.Render(context.Background(), reasoning.TemplateID, request.Version, request.State, request.Data, cardtmpl.BuildEnv{Lang: "zh-CN", SpaceID: "fixture"})
		result := map[string]any{"ok": err == nil}
		if err != nil {
			result["error"] = err.Error()
		}
		output, _ := json.Marshal(result)
		fmt.Println(string(output))
	}
	if err := scanner.Err(); err != nil {
		panic(err)
	}
}
