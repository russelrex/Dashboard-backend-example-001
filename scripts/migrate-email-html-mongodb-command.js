// MongoDB Command to migrate email automations with HTML content
// Run this directly in MongoDB shell or MongoDB Compass

db.automation_rules.find({
  "actions.type": "send-email"
}).forEach(function(rule) {
  let updated = false;
  
  rule.actions.forEach(function(action, index) {
    if (action.type === "send-email" && action.config.body && !action.config.htmlContent) {
      const htmlContent = action.config.body
        .split('\n')
        .map(line => line.trim())
        .filter(line => line.length > 0)
        .join('<br>\n');
      
      rule.actions[index].config.htmlContent = htmlContent;
      updated = true;
    }
  });
  
  if (updated) {
    db.automation_rules.replaceOne({ _id: rule._id }, rule);
    print("Updated rule: " + rule._id + " - " + rule.name);
  }
});

print("Migration completed!");
