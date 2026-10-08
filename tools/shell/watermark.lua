-- Embedded in the C EXE; applied once after the client's Lua main starts.
local ok, result = pcall(function()
  local wm = require("ui.manager.waterMark.waterMarkManager")
  if wm._lurukaps_notice_installed then return true end
  local notice = "LurukaPS 客户端，仅供学习交流使用"
  local function valid(node)
    return L_CommonUtil.isValid(node)
  end
  local function hide_fullscreen(self)
    if valid(self.markImage) then self.markImage.gameObject:ActiveTrans(false) end
    local root = L_UI:getRoot()
    if valid(root) then
      local old = root:Find("[WaterMark]")
      if valid(old) then old.gameObject:SetActive(false) end
    end
  end
  local function show_notice(self)
    hide_fullscreen(self)
    if not self.isEnteredGame then
      if valid(self.testWaterMarkNode) then self.testWaterMarkNode.gameObject:ActiveTrans(false) end
      return
    end
    if not valid(self.testWaterMarkNode) or not valid(self.testWaterMarkTextNode) then return end
    local text = self.testWaterMarkTextNode:GetComponent(typeof(C_LTextMeshProUGUI))
    if not text then return end
    text.text = notice
    local parent = self.testWaterMarkNode.parent
    if valid(parent) then parent.gameObject:SetActive(true) end
    self.testWaterMarkNode.gameObject:ActiveTrans(true)
    self.testWaterMarkTextNode.gameObject:ActiveTrans(true)
    assert(text.text == notice, "local notice TMP readback mismatch")
    if not self._lurukaps_notice_verified then
      self._lurukaps_notice_verified = true
      print("[cbt3-shell] lower-left notice TMP readback verified")
    end
  end
  wm.refreshMarkNode = hide_fullscreen
  wm.refreshTestWaterMark = function(self, active) show_notice(self) end
  wm.setActiveVisiableWaterMark = function(self, root) show_notice(self) end
  local entered = assert(wm.onEvent_enterGame, "watermark entry callback missing")
  wm.onEvent_enterGame = function(self, ...)
    entered(self, ...)
    show_notice(self)
  end
  wm._lurukaps_notice_installed = true
  print("[cbt3-shell] watermark manager policy installed")
  return true
end)
if not ok then print("[cbt3-shell] watermark policy failed: " .. tostring(result)) end
return ok and result
