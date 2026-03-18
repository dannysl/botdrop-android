package app.botdrop;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertFalse;
import static org.junit.Assert.assertTrue;

import org.junit.Test;
import org.w3c.dom.Document;
import org.w3c.dom.Element;
import org.w3c.dom.NodeList;

import java.io.File;
import java.util.Arrays;
import java.util.HashSet;
import java.util.Set;

import javax.xml.parsers.DocumentBuilderFactory;

public class BotDropUiResourceConsistencyTest {

    private static final String ANDROID_NS = "http://schemas.android.com/apk/res/android";
    private static final File PROJECT_ROOT = findProjectRoot();

    @Test
    public void zhStringsIncludeNewDashboardAndSettingsKeys() throws Exception {
        Set<String> zhKeys = loadStringNames("app/src/main/res/values-zh-rCN/strings.xml");
        for (String key : Arrays.asList(
            "botdrop_check_updates",
            "botdrop_view_log_title",
            "botdrop_view_log_desc",
            "botdrop_open_web_ui_title",
            "botdrop_open_web_ui_desc",
            "botdrop_automation_panel_desc",
            "botdrop_tools",
            "botdrop_data_recovery",
            "botdrop_data_recovery_desc",
            "botdrop_set",
            "botdrop_terminal_title",
            "botdrop_terminal_desc",
            "botdrop_change_version",
            "botdrop_check_botdrop_update",
            "botdrop_app_version_label",
            "botdrop_openclaw_version_label"
        )) {
            assertTrue("Missing zh-CN string: " + key, zhKeys.contains(key));
        }
    }

    @Test
    public void dashboardPrimaryControlsUseButtonElements() throws Exception {
        Document document = parseXml("app/src/main/res/layout/activity_botdrop_dashboard.xml");

        assertEquals("TextView", findElementById(document, "btn_check_openclaw_update").getTagName());
        assertEquals("LinearLayout", findElementById(document, "btn_start").getTagName());
        assertEquals("LinearLayout", findElementById(document, "btn_stop").getTagName());
        assertEquals("LinearLayout", findElementById(document, "btn_restart").getTagName());
        assertEquals("ImageView", findElementById(document, "btn_start_icon").getTagName());
        assertEquals("ImageView", findElementById(document, "btn_stop_icon").getTagName());
        assertEquals("ImageView", findElementById(document, "btn_restart_icon").getTagName());
    }

    @Test
    public void settingsPrimaryActionsAvoidFixedButtonWidths() throws Exception {
        Document document = parseXml("app/src/main/res/layout/activity_botdrop_settings.xml");

        assertFalse(hasFixedWidth(findElementById(document, "btn_change_openclaw_version")));
        assertFalse(hasFixedWidth(findElementById(document, "btn_check_botdrop_update")));
    }

    @Test
    public void settingsExternalRowsUseOpenInNewIcons() throws Exception {
        Document document = parseXml("app/src/main/res/layout/activity_botdrop_settings.xml");

        assertEquals("ImageView", findElementById(document, "settings_website_external_icon").getTagName());
        assertEquals("ImageView", findElementById(document, "settings_docs_external_icon").getTagName());
        assertEquals("ImageView", findElementById(document, "settings_x_external_icon").getTagName());
        assertEquals("ImageView", findElementById(document, "settings_discord_external_icon").getTagName());
    }

    @Test
    public void resourceFilesDoNotKeepKnownUnusedStrings() throws Exception {
        Set<String> baseKeys = loadStringNames("app/src/main/res/values/strings.xml");
        Set<String> zhKeys = loadStringNames("app/src/main/res/values-zh-rCN/strings.xml");

        for (String key : Arrays.asList(
            "botdrop_gateway_starting",
            "botdrop_open_automation_panel",
            "botdrop_backup_restore",
            "botdrop_open_terminal",
            "botdrop_checking_updates",
            "botdrop_versions",
            "botdrop_row_chevron",
            "botdrop_channel_id",
            "botdrop_openclaw_web_update_title",
            "botdrop_copy_label",
            "botdrop_no_browser_app_found"
        )) {
            assertFalse("Unused English string still present: " + key, baseKeys.contains(key));
            assertFalse("Unused zh-CN string still present: " + key, zhKeys.contains(key));
        }
    }

    @Test
    public void zhGatewayStatusStringsKeepGatewayTerm() throws Exception {
        Document document = parseXml("app/src/main/res/values-zh-rCN/strings.xml");

        assertEquals("启动 Gateway 失败", findStringValue(document, "botdrop_gateway_start_failed"));
        assertEquals("Gateway 已启动", findStringValue(document, "botdrop_gateway_started"));
        assertEquals("Gateway 已重启", findStringValue(document, "botdrop_gateway_restarted"));
        assertEquals("Gateway 已成功重启", findStringValue(document, "botdrop_gateway_restarted_successfully"));
        assertEquals("Gateway 重启失败", findStringValue(document, "botdrop_gateway_restart_failed"));
        assertEquals("正在重启 Gateway", findStringValue(document, "botdrop_gateway_restarting"));
        assertEquals("正在为新模型重启 Gateway", findStringValue(document, "botdrop_gateway_restarting_with_new_model"));
        assertEquals("停止 Gateway 失败", findStringValue(document, "botdrop_gateway_stop_failed"));
        assertEquals("Gateway 已停止", findStringValue(document, "botdrop_gateway_stopped_toast"));
    }

    private static boolean hasFixedWidth(Element element) {
        String width = element.getAttributeNS(ANDROID_NS, "layout_width");
        return width != null && width.endsWith("dp");
    }

    private static Set<String> loadStringNames(String relativePath) throws Exception {
        Document document = parseXml(relativePath);
        Set<String> keys = new HashSet<>();
        NodeList strings = document.getElementsByTagName("string");
        for (int i = 0; i < strings.getLength(); i++) {
            Element element = (Element) strings.item(i);
            keys.add(element.getAttribute("name"));
        }
        return keys;
    }

    private static Element findElementById(Document document, String id) {
        NodeList allElements = document.getElementsByTagName("*");
        for (int i = 0; i < allElements.getLength(); i++) {
            Element element = (Element) allElements.item(i);
            String elementId = element.getAttributeNS(ANDROID_NS, "id");
            if (("@+id/" + id).equals(elementId) || ("@id/" + id).equals(elementId)) {
                return element;
            }
        }
        throw new AssertionError("Could not find view with id " + id);
    }

    private static String findStringValue(Document document, String name) {
        NodeList strings = document.getElementsByTagName("string");
        for (int i = 0; i < strings.getLength(); i++) {
            Element element = (Element) strings.item(i);
            if (name.equals(element.getAttribute("name"))) {
                return element.getTextContent().trim();
            }
        }
        throw new AssertionError("Could not find string " + name);
    }

    private static Document parseXml(String relativePath) throws Exception {
        File file = new File(PROJECT_ROOT, relativePath);
        if (!file.isFile()) {
            throw new java.io.FileNotFoundException(file.getAbsolutePath());
        }
        DocumentBuilderFactory factory = DocumentBuilderFactory.newInstance();
        factory.setNamespaceAware(true);
        return factory.newDocumentBuilder().parse(file);
    }

    private static File findProjectRoot() {
        File current = new File(System.getProperty("user.dir"));
        while (current != null) {
            if (new File(current, "app/src/main/res").isDirectory()) {
                return current;
            }
            current = current.getParentFile();
        }
        throw new IllegalStateException("Could not locate project root from " + System.getProperty("user.dir"));
    }
}
